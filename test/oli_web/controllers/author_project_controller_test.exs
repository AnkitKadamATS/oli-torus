defmodule OliWeb.AuthorProjectControllerTest do
  use OliWeb.ConnCase

  @admin_email "admin@oli.cmu.edu"
  @invalid_email "hey@example.com"
  setup [:author_project_conn]

  describe "create" do
    test "redirects to project path when data is valid", %{conn: conn, project: project} do
      conn = post(conn, Routes.author_project_path(conn, :create, project), email: @admin_email)
      assert html_response(conn, 302) =~ "/project/"
    end

    test "redirects to project path when data is invalid", %{conn: conn, project: project} do
      conn = post(conn, Routes.author_project_path(conn, :create, project), email: @invalid_email)
      assert html_response(conn, 302) =~ "/project/"
    end
  end

  describe "delete" do

    test "redirects to project path when data is valid", %{conn: conn, project: project} do
      conn = delete(conn, Routes.author_project_path(conn, :delete, project, @admin_email))
      assert html_response(conn, 302) =~ "/project/"
    end

    test "redirects to project path when data is invalid", %{conn: conn, project: project} do
      conn = delete(conn, Routes.author_project_path(conn, :delete, project, @invalid_email))
      assert html_response(conn, 302) =~ "/project/"
    end
  end
end
