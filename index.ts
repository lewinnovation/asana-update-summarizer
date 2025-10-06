import { confirm, input, select } from "@inquirer/prompts";
import clipboardy from "clipboardy";
import createClient from "openapi-fetch";
import type { components, paths } from "./asana-api.d.ts";

type Task = components["schemas"]["TaskCompact"] & {
  notes?: string;
  completed?: boolean;
  due_on?: string | null;
  created_at?: string;
  modified_at?: string;
  tags?: components["schemas"]["TagCompact"];
  memberships?: {
    project?: components["schemas"]["ProjectCompact"];
    section?: components["schemas"]["SectionCompact"];
  }[];
};

async function main() {
  const personalAccessToken =
    process.env.ASANA_PAT ||
    process.env.ASANA_TOKEN ||
    (await input({
      message: "Please enter your Asana Personal Access Token:",
    }));

  if (!personalAccessToken) {
    console.error("Asana Personal Access Token is required.");
    return;
  }

  const client = createClient<paths>({
    baseUrl: "https://app.asana.com/api/1.0",
    headers: {
      Authorization: `Bearer ${personalAccessToken}`,
    },
  });

  try {
    const meResponse = await client.GET("/users/{user_gid}", {
      params: { path: { user_gid: "me" } },
    });
    const { data: me } = meResponse.data ?? {};

    if (!me) {
      throw new Error("Could not fetch user");
    }

    console.log(`Hello, ${me.name}!`);

    const workspacesResponse = await client.GET("/workspaces", {});

    const { data: workspaces } = workspacesResponse.data ?? {};

    if (!workspaces) {
      throw new Error("Could not fetch workspaces");
    }

    const selectedWorkspace = await select({
      message: "Select a workspace:",
      choices: workspaces
        .filter((x) => x.gid !== undefined && x.name !== undefined)
        .map((workspace) => ({
          name: workspace.name!,
          value: workspace.gid!,
        })),
    });

    console.log(`Fetching tasks from "${selectedWorkspace}"...`);

    const tasksResponse = await client.GET("/tasks", {
      params: {
        query: {
          workspace: selectedWorkspace,
          assignee: me.gid!,
          opt_fields: [
            "name",
            "notes",
            "completed",
            "due_on",
            "created_at",
            "modified_at",
            "tags.name",
            "memberships.project.name",
            "memberships.section.name",
          ],
        },
      },
    });
    if (!tasksResponse.data) {
      throw new Error("Could not fetch tasks");
    }
    const tasks = tasksResponse.data.data as Task[];

    if (!tasks) {
      throw new Error("Could not fetch tasks");
    }

    console.log(`Found ${tasks.length} tasks.`);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentTasks = tasks.filter((task) => {
      if (!task.modified_at) {
        return false;
      }
      const modifiedDate = new Date(task.modified_at);
      return modifiedDate >= sevenDaysAgo;
    });

    console.log(
      `Found ${recentTasks.length} tasks modified in the last 7 days.`,
    );

    const workedOnTasks = [];
    for (const task of recentTasks) {
      const project = task.memberships?.[0]?.project?.name || "No Project";
      const section = task.memberships?.[0]?.section?.name || "No Section";
      const include = await confirm({
        message: `Add "${task.name}" (${project} / ${section}) to the list of tasks worked on today?`,
      });

      if (include) {
        const status = await input({ message: "Status:" });
        const comment = await input({ message: "Comment:" });

        const postComment = await confirm({
          message: "Post comment to Asana?",
        });

        if (postComment) {
          await client.POST("/tasks/{task_gid}/stories", {
            params: {
              path: {
                task_gid: task.gid!,
              },
            },
            body: {
              data: {
                text: comment,
              },
            },
          });
          console.log("Comment posted to Asana.");
        }

        workedOnTasks.push({
          task,
          status,
          comment,
        });
      }
    }

    console.log("\nTasks worked on today:");

    let table = "| Project | Section | Name | URL | Status | Comment |\n";
    table += "|---|---|---|---|---|---|\n";

    for (const workedOnTask of workedOnTasks) {
      const task = workedOnTask.task;
      const project = task.memberships?.[0]?.project?.name || "";
      const section = task.memberships?.[0]?.section?.name || "";
      const name = task.name || "";
      const projectGid = task.memberships?.[0]?.project?.gid;
      const url = projectGid
        ? `https://app.asana.com/${selectedWorkspace}/${projectGid}/${task.gid}`
        : `https://app.asana.com/0/0/${task.gid}`;
      const status = workedOnTask.status;
      const comment = workedOnTask.comment;

      table += `| ${project} | ${section} | ${name} | ${url} | ${status} | ${comment} |\n`;
    }

    console.log(table);

    const copyToClipboard = await confirm({
      message: "Copy markdown output to clipboard?",
    });

    if (copyToClipboard) {
      clipboardy.writeSync(table);
      console.log("Copied to clipboard!");
    }
  } catch (error) {
    console.error(
      "Error connecting to Asana. Please check your Personal Access Token.",
      error,
    );
  }
}

main();
