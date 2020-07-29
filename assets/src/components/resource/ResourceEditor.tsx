import * as Immutable from 'immutable';
import React from 'react';
import { toKeyCode } from 'is-hotkey';
import { PersistenceStrategy } from 'data/persistence/PersistenceStrategy';
import { DeferredPersistenceStrategy } from 'data/persistence/DeferredPersistenceStrategy';
import { ResourceContent, ResourceContext,
  Activity, ActivityMap, createDefaultStructuredContent } from 'data/content/resource';
import { Objective } from 'data/content/objective';
import { ActivityEditorMap } from 'data/content/editors';
import { Editors } from './Editors';
import { TitleBar } from '../content/TitleBar';
import { UndoRedo } from '../content/UndoRedo';
import { PersistenceStatus } from 'components/content/PersistenceStatus';
import { ProjectSlug, ResourceSlug, ObjectiveSlug } from 'data/types';
import * as Persistence from 'data/persistence/resource';
import {
  UndoableState, processRedo, processUndo, processUpdate, init,
  registerUndoRedoHotkeys, unregisterUndoRedoHotkeys,
} from './undo';
import { releaseLock, acquireLock, NotAcquired } from 'data/persistence/lock';
import { Message, Severity, createMessage } from 'data/messages/messages';
import { Banner } from '../messages/Banner';
import { create } from 'data/persistence/objective';
import { isFirefox } from 'utils/browser';

export interface ResourceEditorProps extends ResourceContext {
  editorMap: ActivityEditorMap;   // Map of activity types to activity elements
  activities: ActivityMap;
}

// This is the state of our resource that is undoable
type Undoable = {
  title: string,
  content: Immutable.List<ResourceContent>,
  objectives: Immutable.List<ObjectiveSlug>,
};

type ResourceEditorState = {
  messages: Message[],
  undoable: UndoableState<Undoable>,
  allObjectives: Immutable.List<Objective>,
  childrenObjectives: Immutable.Map<ObjectiveSlug, Immutable.List<Objective>>,
  activities: Immutable.Map<string, Activity>,
  editMode: boolean,
  persistence: 'idle' | 'pending' | 'inflight',
  previewMode: boolean,
  previewHtml: string,
  metaModifier: boolean,
};

// Creates a function that when invoked submits a save request
function prepareSaveFn(
  project: ProjectSlug, resource: ResourceSlug, update: Persistence.ResourceUpdate) {

  return (releaseLock : boolean) => Persistence.edit(project, resource, update, releaseLock);
}

// Ensures that there is some default content if the initial content
// of this resource is empty
function withDefaultContent(content: ResourceContent[]) {
  return content.length > 0
    ? content
    : [createDefaultStructuredContent()];
}


function registerUnload(strategy: PersistenceStrategy) {
  return window.addEventListener('beforeunload', (event) => {

    if (isFirefox) {
      setTimeout(() => strategy.destroy());
    } else {
      strategy.destroy();
    }

  });
}

function unregisterUnload(listener: any) {
  window.removeEventListener('beforeunload', listener);
}

export function registerKeydown(self: ResourceEditor) {
  return window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.keyCode === toKeyCode('mod') && !e.repeat) {
      self.setState({ metaModifier: true });
    }
  });
}

export function unregisterKeydown(listener: any) {
  window.removeEventListener('keydown', listener);
}

export function registerKeyup(self: ResourceEditor) {
  return window.addEventListener('keyup', (e: KeyboardEvent) => {
    if (e.keyCode === toKeyCode('mod')) {
      self.setState({ metaModifier: false });
    }
  });
}

export function unregisterKeyup(listener: any) {
  window.removeEventListener('keyup', listener);
}

export function registerWindowBlur(self: ResourceEditor) {
  return window.addEventListener('blur', (e) => {
    self.setState({ metaModifier: false });
  });
}

export function unregisterWindowBlur(listener: any) {
  window.removeEventListener('blur', listener);
}


function mapChildrenObjectives(objectives: Objective[])
  : Immutable.Map<ObjectiveSlug, Immutable.List<Objective>> {

  return objectives.reduce(
    (map, o) => {
      if (o.parentSlug !== null) {
        let updatedMap = map;
        if (o.parentSlug !== null && !map.has(o.parentSlug)) {
          updatedMap = updatedMap.set(o.parentSlug, Immutable.List());
        }
        const appended = (updatedMap.get(o.parentSlug) as any).push(o);
        return updatedMap.set(o.parentSlug, appended);
      }
      return map;
    },
    Immutable.Map<ObjectiveSlug, Immutable.List<Objective>>(),
  );
}

// The resource editor
export class ResourceEditor extends React.Component<ResourceEditorProps, ResourceEditorState> {

  persistence: PersistenceStrategy;
  windowUnloadListener: any;
  undoRedoListener: any;
  keydownListener: any;
  keyupListener: any;
  windowBlurListener: any;

  constructor(props: ResourceEditorProps) {
    super(props);

    const { title, objectives, allObjectives, content, activities } = props;

    this.state = {
      messages: [],
      editMode: true,
      undoable: init({
        title,
        objectives: Immutable.List<ObjectiveSlug>(objectives.attached),
        content: Immutable.List<ResourceContent>(withDefaultContent(content.model)),
      }),
      persistence: 'idle',
      allObjectives: Immutable.List<Objective>(allObjectives),
      childrenObjectives: mapChildrenObjectives(allObjectives),
      activities: Immutable.Map<string, Activity>(
        Object.keys(activities).map(k => [k, activities[k]])),
      previewMode: false,
      previewHtml: '',
      metaModifier: false,
    };

    this.persistence = new DeferredPersistenceStrategy();

    this.update = this.update.bind(this);
    this.undo = this.undo.bind(this);
    this.redo = this.redo.bind(this);

  }

  componentDidMount() {

    const { projectSlug, resourceSlug } = this.props;

    this.persistence.initialize(
      acquireLock.bind(undefined, projectSlug, resourceSlug),
      releaseLock.bind(undefined, projectSlug, resourceSlug),
      () => {},
      failure => this.publishErrorMessage(failure),
      persistence => this.setState({ persistence }),
    ).then((editMode) => {
      this.setState({ editMode });
      if (editMode) {
        this.windowUnloadListener = registerUnload(this.persistence);
        this.undoRedoListener = registerUndoRedoHotkeys(this.undo.bind(this), this.redo.bind(this));
        this.keydownListener = registerKeydown(this);
        this.keyupListener = registerKeyup(this);
        this.windowBlurListener = registerWindowBlur(this);
      } else {
        if (this.persistence.getLockResult().type === 'not_acquired') {
          const notAcquired: NotAcquired = this.persistence.getLockResult() as NotAcquired;
          this.editingLockedMessage(notAcquired.user);
        }
      }
    });
  }

  componentWillUnmount() {

    this.persistence.destroy();

    unregisterUnload(this.windowUnloadListener);
    unregisterUndoRedoHotkeys(this.undoRedoListener);
    unregisterKeydown(this.keydownListener);
    unregisterKeyup(this.keyupListener);
    unregisterWindowBlur(this.windowBlurListener);
  }

  editingLockedMessage(email: string) {
    const message = createMessage({
      canUserDismiss: false,
      content: 'Read Only. User ' + email + ' is currently editing this page.',
      severity: Severity.Information,
    });
    this.setState({ messages: [...this.state.messages, message] });
  }

  publishErrorMessage(failure: any) {
    const message = createMessage({
      canUserDismiss: true,
      content: 'A problem occurred while saving your changes',
    });
    this.setState({ messages: [...this.state.messages, message] });
  }

  createObjectiveErrorMessage(failure: any) {
    const message = createMessage({
      canUserDismiss: true,
      content: 'A problem occurred while creating your new objective',
      severity: Severity.Error,
    });
    this.setState({ messages: [...this.state.messages, message] });
  }

  showPreviewMessage(isGraded: boolean) {
    const content = isGraded
      ? <p>
          This is a preview of your graded assessment, but it is being
          displayed as an ungraded page to show feedback and hints</p>

      : <p>This is a preview of your ungraded page</p>;

    const message = createMessage({
      canUserDismiss: false,
      content: (
        <div>
          <strong>Preview Mode</strong><br />
          {content}
        </div>
      ),
      severity: Severity.Information,
      actions: [{
        label: 'Exit Preview',
        enabled: true,
        btnClass: 'btn-warning',
        execute: (message: Message) => {
          // exit preview mode and remove preview message
          this.setState({
            messages: this.state.messages.filter(m => m.guid !== message.guid),
            previewMode: false,
            previewHtml: '',
          });

        },
      }],
    });
    this.setState({ messages: [...this.state.messages, message] });
  }

  onPreviewClick = () => {
    const { previewMode } = this.state;
    const { projectSlug, resourceSlug, graded } = this.props;

    const enteringPreviewMode = !previewMode;

    if (enteringPreviewMode) {
      // otherwise, switch the current view to preview mode
      this.setState({ previewMode: !previewMode, previewHtml: '' });
      this.showPreviewMessage(graded);

      fetch(`/project/${projectSlug}/resource/${resourceSlug}/preview`)
      .then((res) => {
        if (res.ok) {
          return res.text();
        }
      })
      .then((html) => {
        if (html) {
          this.setState({ previewHtml: html });
        }
      });
    }
  }

  update(update: Partial<Undoable>) {
    this.setState(
      { undoable: processUpdate(this.state.undoable, update) },
      () => this.save());
  }

  save() {
    const { projectSlug, resourceSlug } = this.props;

    const toSave : Persistence.ResourceUpdate = {
      objectives: { attached: this.state.undoable.current.objectives.toArray() },
      title: this.state.undoable.current.title,
      content: { model: this.state.undoable.current.content.toArray() },
      releaseLock: false,
    };

    this.persistence.save(
      prepareSaveFn(projectSlug, resourceSlug, toSave));
  }

  undo() {
    this.setState({ undoable: processUndo(this.state.undoable) },
    () => this.save());
  }

  redo() {
    this.setState({ undoable: processRedo(this.state.undoable) },
    () => this.save());
  }

  render() {

    const props = this.props;
    const state = this.state;

    const { projectSlug, resourceSlug, title } = this.props;
    const page = {
      slug: resourceSlug,
      title,
    };

    const onEdit = (content: Immutable.List<ResourceContent>) => {
      this.update({ content });
    };

    const onTitleEdit = (title: string) => {
      this.update({ title });
    };

    const onAddItem = (c : ResourceContent, index: number, a? : Activity) => {
      this.update({ content: this.state.undoable.current.content.insert(index, c) });
      if (a) {
        this.setState({ activities: this.state.activities.set(a.activitySlug, a) });
      }
    };

    const onRegisterNewObjective = (title: string) : Promise<Objective> => {
      return new Promise((resolve, reject) => {

        create(props.projectSlug, title)
        .then((result) => {
          if (result.type === 'success') {

            const objective = {
              slug: result.revisionSlug,
              title,
              parentSlug: null,
            };

            this.setState({
              allObjectives: this.state.allObjectives.push(objective),
              childrenObjectives:
                this.state.childrenObjectives.set(objective.slug, Immutable.List<Objective>()),
            });

            resolve(objective);

          } else {
            throw result;
          }
        })
        .catch((e) => {
          this.createObjectiveErrorMessage(e);
          console.error('objective creation failed', e);
        });

      });
    };

    const isSaving =
      (this.state.persistence === 'inflight' || this.state.persistence === 'pending');


    const PreviewButton = () => state.metaModifier
    ? (
      <a
        className={`btn btn-sm btn-outline-primary ml-3 ${isSaving ? 'disabled' : ''}`}
        onClick={() => window.open(`/project/${projectSlug}/resource/${resourceSlug}/preview`, 'page-preview')}>
        Preview Page <i className="las la-external-link-alt ml-1"></i>
      </a>
    )
    : (
      <button
        role="button"
        className="btn btn-sm btn-outline-primary ml-3"
        onClick={this.onPreviewClick}
        disabled={isSaving}>
        Preview Page
      </button>
    );

    if (state.previewMode) {
      return (
        <div className="row">
          <div className="col-12 d-flex flex-column">
            <Banner
              dismissMessage={msg => this.setState(
                { messages: this.state.messages.filter(m => msg.guid !== m.guid) })}
              executeAction={(message, action) => action.execute(message)}
              messages={this.state.messages}
            />
            <div
              className="preview-content delivery flex-grow-1"
              dangerouslySetInnerHTML={{ __html: state.previewHtml }}
              ref={(div) => {
                // when this div is rendered and contains rendered preview html,
                // find and execute all scripts required to run the delivery elements
                if (div && state.previewHtml !== '') {
                  const scripts = div.getElementsByTagName('script');
                  for (const s of scripts) {
                    if (s.innerText) {
                      window.eval(s.innerText);
                    }
                  }

                  // highlight all codeblocks
                  div.querySelectorAll('pre code').forEach((block) => {
                    (window as any).hljs.highlightBlock(block);
                  });
                }
              }}
              />
          </div>
        </div>
      );
    }

    return (
      <div className="row">
        <div className="col-12">
          <Banner
            dismissMessage={msg => this.setState(
              { messages: this.state.messages.filter(m => msg.guid !== m.guid) })}
            executeAction={(message, action) => action.execute(message)}
            messages={this.state.messages}
          />
          <TitleBar
            title={state.undoable.current.title}
            onTitleEdit={onTitleEdit}
            editMode={this.state.editMode}>
            <PersistenceStatus persistence={this.state.persistence}/>

            <PreviewButton />

            <UndoRedo
              canRedo={this.state.undoable.redoStack.size > 0}
              canUndo={this.state.undoable.undoStack.size > 0}
              onUndo={this.undo} onRedo={this.redo}/>
          </TitleBar>
          <div>
            <Editors {...props} editMode={this.state.editMode}
              objectives={this.state.allObjectives}
              childrenObjectives={this.state.childrenObjectives}
              onRegisterNewObjective={onRegisterNewObjective}
              activities={this.state.activities}
              onRemove={index => onEdit(this.state.undoable.current.content.delete(index))}
              onEdit={(c, index) => {
                onEdit(this.state.undoable.current.content.set(index, c));
              }}
              onEditContentList={onEdit}
              content={this.state.undoable.current.content}
              onAddItem={onAddItem}
              resourceContext={props} />
          </div>
        </div>
      </div>
    );
  }
}
