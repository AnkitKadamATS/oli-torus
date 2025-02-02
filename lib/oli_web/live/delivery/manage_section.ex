defmodule OliWeb.Delivery.ManageSection do
  use OliWeb, :live_view

  import OliWeb.ViewHelpers,
    only: [
      is_section_instructor_or_admin?: 2,
      is_admin?: 2
    ]

  alias Oli.Repo
  alias Oli.Delivery.Sections
  alias OliWeb.Router.Helpers, as: Routes
  alias Oli.Accounts
  alias Oli.Delivery.Student.Summary

  def mount(
        _params,
        %{"section_slug" => section_slug, "current_user_id" => current_user_id},
        socket
      ) do
    current_user = Accounts.get_user!(current_user_id) |> Repo.preload([:platform_roles, :author])

    # only permit instructor or admin level access
    if is_section_instructor_or_admin?(section_slug, current_user) do
      section = Sections.get_section_by_slug(section_slug)
      {:ok, summary} = Summary.get_summary(section_slug, current_user)

      socket =
        socket
        |> assign(:section, section)
        |> assign(:current_user, current_user)
        |> assign(:summary, summary)

      {:ok, socket}
    else
      {:ok, redirect(socket, to: Routes.static_page_path(OliWeb.Endpoint, :unauthorized))}
    end
  end

  def render(assigns) do
    # link_text = dgettext("grades", "Download Gradebook")

    ~L"""
      <div class="mb-2">
        <%= link to: Routes.page_delivery_path(OliWeb.Endpoint, :index, @section.slug) do %>
          <i class="las la-arrow-left"></i> Back
        <% end %>
      </div>

      <h2><%= dgettext("section", "Manage Section") %></h2>

      <div class="card my-4">
        <h6 class="card-header">
          Grades
        </h6>
        <div class="card-body">
          <p class="card-text">Synchronize LMS grade book and export grades.</p>
          <%= link "Manage Grades", to: Routes.live_path(OliWeb.Endpoint, OliWeb.Grades.GradesLive, @section.slug), class: "btn btn-sm btn-primary" %>
        </div>
      </div>

      <div class="card my-4">
        <h6 class="card-header">
          <%= case Enum.count(@summary.updates) do %>
            <% 0 -> %>
              Updates
            <% num_updates -> %>
              Updates <span class="badge badge-primary"><%= num_updates %></span>
          <% end %>
        </h6>
        <div class="card-body">
          <p class="card-text">Course material updates will become available when changes to source projects are published.</p>
          <%= link "Manage Updates", to: Routes.page_delivery_path(OliWeb.Endpoint, :updates, @section.slug), class: "btn btn-sm btn-primary" %>
        </div>
      </div>

      <div class="card my-4">
        <h6 class="card-header">
          Remix
        </h6>
        <div class="card-body">
          <p class="card-text">Customize your curriculum by adding, removing and rearranging course materials.</p>
          <%= link "Curriculum Remix", to: Routes.live_path(OliWeb.Endpoint, OliWeb.Delivery.RemixSection, @section.slug), class: "btn btn-sm btn-primary" %>
        </div>
      </div>

      <%= if is_admin?(@section.slug, @current_user) do %>
        <div class="card border-warning my-4">
          <h6 class="card-header">
            Admin Tools
          </h6>
          <div class="card-body border-warning">
            <h5 class="card-title">Unlink this Section</h5>
            <p class="card-text">If your section was created from the wrong project or you simply wish to start over, you can unlink this section.</p>
            <button type="button" class="btn btn-sm btn-outline-danger" data-toggle="modal" data-target="#deleteSectionModal">Unlink Section</button>
          </div>
        </div>

        <!-- delete section modal -->
        <div class="modal fade" id="deleteSectionModal" tabindex="-1" role="dialog" aria-labelledby="deleteSectionModal" aria-hidden="true">
          <div class="modal-dialog" role="document">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title" id="deleteSectionModal">Confirm Unlink Section</h5>
                <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                  <span aria-hidden="true">&times;</span>
                </button>
              </div>
              <div class="modal-body">
                Are you sure you want to unlink this section?
                <div class="alert alert-danger my-2" role="alert">
                  <b>Warning:</b> This action cannot be undone
                </div>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-dismiss="modal">Cancel</button>
                <button type="button" class="btn btn-danger" phx-click="unlink_section" phx-disable-with="Unlinking...">Confirm Unlink Section</button>
              </div>
            </div>
          </div>
        </div>
      <% end %>
    """
  end

  def handle_event("unlink_section", _, socket) do
    %{section: section} = socket.assigns

    {:ok, _deleted} = Sections.soft_delete_section(section)

    {:noreply, push_redirect(socket, to: Routes.delivery_path(socket, :index))}
  end
end
