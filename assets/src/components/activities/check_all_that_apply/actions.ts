import { CheckAllThatApplyModelSchema as CATA, TargetedCATA } from './schema';
import { createRuleForIds, fromText, getChoice, getCorrectResponse,
  getHint, getResponse, getChoiceIds, getCorrectChoiceIds, getIncorrectChoiceIds,
  getIncorrectResponse, getResponseId, setDifference, invertRule, unionRules, getResponses,
  makeResponse,
  isSimpleCATA} from './utils';
import { RichText, Hint as HintType, ChoiceId, Choice, ResponseId } from '../types';
import { toSimpleText } from 'data/content/text';

export class Actions {

  static toggleType() {
    return (model: CATA) => {
      if (isSimpleCATA(model)) {
        (model as any).type = 'TargetedCATA';
        (model as any).authoring.targeted = [];
        return;
      }

      (model as any).type = 'SimpleCATA';
      delete (model as any).authoring.targeted;
    };
  }

  static editStem(content: RichText) {
    return (model: CATA) => {
      model.stem.content = content;
      const previewText = toSimpleText({ children: content.model } as any);
      model.authoring.previewText = previewText;
    };
  }

  static addChoice() {
    return (model: CATA) => {
      const newChoice: Choice = fromText('');

      model.choices.push(newChoice);
      getChoiceIds(model.authoring.incorrect).push(newChoice.id);
      updateResponseRules(model);
    };
  }

  static editChoiceContent(id: string, content: RichText) {
    return (model: CATA) => {
      getChoice(model, id).content = content;
    };
  }

  static removeChoice(id: string) {
    return (model: CATA) => {
      const removeIdFrom = (list: string[]) => removeFromList(id, list);

      // remove choice from model.choices
      model.choices = model.choices.filter(choice => choice.id !== id);

      // remove choice from model.authoring.correct choice ids
      removeIdFrom(getChoiceIds(model.authoring.correct));

      // remove choice from model.authoring.incorrect choice ids
      removeIdFrom(getChoiceIds(model.authoring.incorrect));

      // if targeted, remove choice from all model.authoring.targeted
      switch (model.type) {
        case 'SimpleCATA': break;
        case 'TargetedCATA':
          model.authoring.targeted.forEach(assoc => removeIdFrom(getChoiceIds(assoc)));
      }

      // update all response rules with new choice ids
      updateResponseRules(model);
    };
  }

  static toggleChoiceCorrectness(choiceId: ChoiceId) {
    return (model: CATA) => {
      const addOrRemoveId = (list: string[]) => addOrRemoveFromList(choiceId, list);
      // targeted response choices do not need to change

      addOrRemoveId(getChoiceIds(model.authoring.correct));
      addOrRemoveId(getChoiceIds(model.authoring.incorrect));
      updateResponseRules(model);
    };
  }

  static editResponseFeedback(responseId: ResponseId, content: RichText) {
    return (model: CATA) => {
      getResponse(model, responseId).feedback.content = content;
    };
  }

  static addTargetedFeedback() {
    return (model: CATA) => {
      switch (model.type) {
        case 'SimpleCATA': return;
        case 'TargetedCATA':
          const response = makeResponse(
            createRuleForIds([], model.choices.map(({ id }) => id)), 0, '');

          getResponses(model).push(response);
          model.authoring.targeted.push([[], response.id]);
          return;
      }
    };
  }

  static removeTargetedFeedback(responseId: ResponseId) {
    return (model: CATA) => {
      switch (model.type) {
        case 'SimpleCATA': return;
        case 'TargetedCATA':
          removeFromList(getResponse(model, responseId), getResponses(model));
          removeFromList(
            model.authoring.targeted.find(assoc => getResponseId(assoc) === responseId),
            model.authoring.targeted);
      }
    };
  }

  static editTargetedFeedbackChoices(choiceIds: ChoiceId[]) {
    return (model: CATA) => {

    };
  }

  static addHint() {
    return (model: CATA) => {
      const newHint: HintType = fromText('');
      // new hints are always cognitive hints. they should be inserted
      // right before the bottomOut hint at the end of the list
      const bottomOutIndex = model.authoring.parts[0].hints.length - 1;
      model.authoring.parts[0].hints.splice(bottomOutIndex, 0, newHint);
    };
  }

  static editHint(id: string, content: RichText) {
    return (model: CATA) => {
      getHint(model, id).content = content;
    };
  }

  static removeHint(id: string) {
    return (model: CATA) => {
      model.authoring.parts[0].hints = model.authoring.parts[0].hints
      .filter(h => h.id !== id);
    };
  }
}

// mutable
function addOrRemoveFromList<T>(item: T, list: T[]) {
  if (list.find(x => x === item)) {
    return removeFromList(item, list);
  }
  return list.push(item);
}
// mutable
function removeFromList<T>(item: T, list: T[]) {
  const index = list.findIndex(x => x === item);
  if (index > -1) {
    list.splice(index, 1);
  }
}

// Update all response rules based on a model with new choices that
// are not yet reflected by the rules.
const updateResponseRules = (model: CATA) => {

  getCorrectResponse(model).rule = createRuleForIds(
    getCorrectChoiceIds(model),
    getIncorrectChoiceIds(model));

  switch (model.type) {
    case 'SimpleCATA':
      getIncorrectResponse(model).rule = invertRule(getCorrectResponse(model).rule);
      break;
    case 'TargetedCATA':
      const targetedRules: string[] = [];
      const allChoiceIds = model.choices.map(choice => choice.id);
      model.authoring.targeted.forEach((assoc) => {
        const targetedRule = createRuleForIds(
          getChoiceIds(assoc),
          setDifference(
            allChoiceIds,
            getChoiceIds(assoc)));
        targetedRules.push(targetedRule);
        getResponse(model, getResponseId(assoc)).rule = targetedRule;
      });
      getIncorrectResponse(model).rule = unionRules(
        targetedRules.map(invertRule)
          .concat([invertRule(getCorrectResponse(model).rule)]));
      break;
  }
};
