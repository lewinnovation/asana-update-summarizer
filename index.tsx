import React, { useState, useEffect } from "react";
import { render, Box, Text } from "ink";
import { MultiSelect, Select, TextInput, Spinner } from "@inkjs/ui";
import Table from "ink-table";
import clipboardy from "clipboardy";
import { exit } from "node:process";
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

type WorkedOnTask = {
  task: Task;
  status: string;
  comment: string;
};

type AppState =
  | { name: "pat" }
  | { name: "workspaces"; client: ReturnType<typeof createClient<paths>> }
  | {
      name: "tasks";
      client: ReturnType<typeof createClient<paths>>;
      workspace: string;
    }
  | {
      name: "selectTasks";
      client: ReturnType<typeof createClient<paths>>;
      tasks: Task[];
    }
  | {
      name: "status";
      client: ReturnType<typeof createClient<paths>>;
      selectedTasks: Task[];
      workedOnTasks: WorkedOnTask[];
      currentTaskIndex: number;
    }
  | {
      name: "comment";
      client: ReturnType<typeof createClient<paths>>;
      selectedTasks: Task[];
      workedOnTasks: WorkedOnTask[];
      currentTaskIndex: number;
      status: string;
    }
  | {
      name: "postComment";
      client: ReturnType<typeof createClient<paths>>;
      selectedTasks: Task[];
      workedOnTasks: WorkedOnTask[];
      currentTaskIndex: number;
      status: string;
      comment: string;
    }
  | {
      name: "postingComment";
      client: ReturnType<typeof createClient<paths>>;
      selectedTasks: Task[];
      workedOnTasks: WorkedOnTask[];
      currentTaskIndex: number;
      status: string;
      comment: string;
    }
  | { name: "summary"; workedOnTasks: WorkedOnTask[] }
  | { name: "exit" };

const generateSummaryTableData = (workedOnTasks: WorkedOnTask[]) => {
  return workedOnTasks.map((workedOnTask) => {
    const task = workedOnTask.task;
    const project = task.memberships?.[0]?.project?.name || "";
    const section = task.memberships?.[0]?.section?.name || "";
    const name = task.name || "";
    const url = getTaskUrl(task);
    const status = workedOnTask.status;
    const comment = workedOnTask.comment;

    return {
      Project: project,
      Section: section,
      Name: name,
      URL: url,
      Status: status,
      Comment: comment,
    };
  });
};

const generateSummaryTable = (workedOnTasks: WorkedOnTask[]) => {
  let table = "| Project | Section | Name | URL | Status | Comment |\n";
  table += "|---|---|---|---|---|---|\n";

  for (const workedOnTask of workedOnTasks) {
    const task = workedOnTask.task;
    const project = task.memberships?.[0]?.project?.name || "";
    const section = task.memberships?.[0]?.section?.name || "";
    const name = task.name || "";
    const url = getTaskUrl(task);
    const status = workedOnTask.status;
    const comment = workedOnTask.comment;

    table += `| ${project} | ${section} | ${name} | ${url} | ${status} | ${comment} |\n`;
  }

  return table;
};

const SummaryTable = ({ workedOnTasks }: { workedOnTasks: WorkedOnTask[] }) => {
  const data = generateSummaryTableData(workedOnTasks);
  return <Table data={data} />;
};

const getTaskUrl = (task: Task) => {
  const projectGid = task.memberships?.[0]?.project?.gid;
  return projectGid
    ? `https://app.asana.com/0/${projectGid}/${task.gid}`
    : `https://app.asana.com/0/0/${task.gid}`;
};

const App = () => {
  console.log('App rendering started')
  const [state, setState] = useState<AppState>({ name: "pat" });
  const [pat, setPat] = useState(
    process.env.ASANA_PAT || process.env.ASANA_TOKEN || ""
  );
  const [me, setMe] = useState<components["schemas"]["UserCompact"]>();
  const [workspaces, setWorkspaces] = useState<
    components["schemas"]["WorkspaceCompact"][]
  >([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (pat && state.name === "pat") {
      const c = createClient<paths>({
        baseUrl: "https://app.asana.com/api/1.0",
        headers: {
          Authorization: `Bearer ${pat}`,
        },
      });
      c.GET("/users/{user_gid}", {
        params: { path: { user_gid: "me" } },
      })
        .then(({ data }) => {
          if (data?.data) {
            setMe(data.data);
            setState({ name: "workspaces", client: c });
          } else {
            setError("Could not fetch user. Please check your PAT.");
            setState({ name: "pat" });
          }
        })
        .catch((err) => {
          setError(
            `Error connecting to Asana. Please check your Personal Access Token. ${err.message}`
          );
        });
    }
  }, [pat, state]);

  useEffect(() => {
    if (state.name === "workspaces") {
      state.client.GET("/workspaces", {}).then(({ data }) => {
        if (data?.data) {
          setWorkspaces(data.data);
        } else {
          setError("Could not fetch workspaces.");
        }
      });
    }
  }, [state]);

  useEffect(() => {
    if (state.name === "tasks" && me?.gid) {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const sevenDaysAgoIso = sevenDaysAgo.toISOString();

      // Fetch assigned tasks
      const assignedTasksPromise = state.client.GET("/tasks", {
        params: {
          query: {
            workspace: state.workspace,
            assignee: me.gid!,
            limit: 100,
            modified_since: sevenDaysAgoIso,
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

      // Fetch followed tasks (requires premium)
      const followedTasksPromise = state.client
        .GET("/workspaces/{workspace_gid}/tasks/search", {
          params: {
            path: {
              workspace_gid: state.workspace,
            },
            query: {
              "followers.any": me.gid!,
              limit: 100,
              "modified_at.after": sevenDaysAgoIso,
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
        })
        .then((result) => {
          // If there's an error response with 402 (Payment Required), return empty data
          if (result.response?.status === 402) {
            return { data: { data: [] } };
          }
          return result;
        })
        .catch((err) => {
          // Handle 402 Payment Required for non-premium users
          // openapi-fetch may throw errors for HTTP errors in some cases
          const status =
            err.status ||
            err.response?.status ||
            (err as { response?: { status?: number } })?.response?.status;
          if (status === 402) {
            // Return empty array if user doesn't have premium access
            return { data: { data: [] } };
          }
          // Re-throw other errors
          throw err;
        });

      Promise.all([assignedTasksPromise, followedTasksPromise])
        .then(([assignedResult, followedResult]) => {
          const assignedTasks = (assignedResult.data?.data || []) as Task[];
          const followedTasks = (followedResult.data?.data || []) as Task[];

          // Merge and deduplicate tasks by gid
          const taskMap = new Map<string, Task>();
          assignedTasks.forEach((task) => {
            if (task.gid) {
              taskMap.set(task.gid, task);
            }
          });
          followedTasks.forEach((task) => {
            if (task.gid) {
              taskMap.set(task.gid, task);
            }
          });

          const allTasks = Array.from(taskMap.values());

          // Filter tasks modified in the last 7 days (safety check, though API should handle it)
          const recent = allTasks.filter((task) => {
            if (!task.modified_at) {
              return false;
            }
            const modifiedDate = new Date(task.modified_at);
            return modifiedDate >= sevenDaysAgo;
          });

          setState({
            name: "selectTasks",
            client: state.client,
            tasks: recent,
          });
        })
        .catch((err) => {
          setError(
            `Error fetching tasks: ${err.message || "Could not fetch tasks."}`
          );
        });
    }
  }, [state, me]);

  const handlePatSubmit = (value: string) => {
    setPat(value);
  };

  const handleWorkspaceSelect = (value: string) => {
    if (state.name === "workspaces") {
      setState({
        name: "tasks",
        client: state.client,
        workspace: value,
      });
    }
  };

  const handleTasksSelect = (values: string[]) => {
    if (state.name === "selectTasks") {
      const selectedTasks = state.tasks.filter((task) =>
        values.includes(task.gid!)
      );
      setState({
        name: "status",
        client: state.client,
        selectedTasks,
        workedOnTasks: [],
        currentTaskIndex: 0,
      });
    }
  };

  const handleStatusSubmit = (value: string) => {
    if (state.name === "status") {
      setState({
        name: "comment",
        client: state.client,
        selectedTasks: state.selectedTasks,
        workedOnTasks: state.workedOnTasks,
        currentTaskIndex: state.currentTaskIndex,
        status: value,
      });
    }
  };

  const handleCommentSubmit = (value: string) => {
    if (state.name === "comment") {
      setState({
        name: "postComment",
        client: state.client,
        selectedTasks: state.selectedTasks,
        workedOnTasks: state.workedOnTasks,
        currentTaskIndex: state.currentTaskIndex,
        status: state.status,
        comment: value,
      });
    }
  };

  const handlePostComment = async (value: string) => {
    if (state.name === "postComment") {
      const task = state.selectedTasks[state.currentTaskIndex];
      if (!task) {
        return;
      }
      if (value === "yes") {
        setState({
          name: "postingComment",
          client: state.client,
          selectedTasks: state.selectedTasks,
          workedOnTasks: state.workedOnTasks,
          currentTaskIndex: state.currentTaskIndex,
          status: state.status,
          comment: state.comment,
        });

        try {
          await state.client.POST("/tasks/{task_gid}/stories", {
            params: {
              path: {
                task_gid: task.gid!,
              },
            },
            body: {
              data: {
                text: state.comment,
              },
            },
          });
        } catch (e) {
          setError(`Failed to post comment: ${(e as Error).message}`);
          return;
        }
      }
      const newWorkedOnTasks = [
        ...state.workedOnTasks,
        {
          task,
          status: state.status,
          comment: state.comment,
        },
      ];
      if (state.currentTaskIndex === state.selectedTasks.length - 1) {
        setState({ name: "summary", workedOnTasks: newWorkedOnTasks });
      } else {
        setState({
          name: "status",
          client: state.client,
          selectedTasks: state.selectedTasks,
          workedOnTasks: newWorkedOnTasks,
          currentTaskIndex: state.currentTaskIndex + 1,
        });
      }
    }
  };

  const handleCopyToClipboard = (value: string) => {
    if (value === "yes" && state.name === "summary") {
      const table = generateSummaryTable(state.workedOnTasks);
      try {
        clipboardy.writeSync(table);
      } catch (e) {
        console.error("Failed to copy to clipboard:", (e as Error).message);
      }
    }
    exit(0);
  };

  if (error) {
    return <Text color="red">{error}</Text>;
  }

  if (state.name === "pat") {
    return (
      <Box>
        <Text>Please enter your Asana Personal Access Token: </Text>
        <TextInput onChange={setPat} onSubmit={handlePatSubmit} />
      </Box>
    );
  }

  if (state.name === "workspaces") {
    return (
      <Box>
        <Text>Select a workspace: </Text>
        <Select
          options={workspaces.map((w) => ({ label: w.name!, value: w.gid! }))}
          onChange={handleWorkspaceSelect}
        />
      </Box>
    );
  }

  if (state.name === "tasks") {
    return (
      <Box>
        <Spinner type="dots" />
        <Text> Fetching tasks...</Text>
      </Box>
    );
  }

  if (state.name === "selectTasks") {
    return (
      <Box>
        <Text>Select tasks you worked on: </Text>
        <MultiSelect
          options={state.tasks.map((task) => ({
            label: `${task.name} (${
              task.memberships?.[0]?.project?.name || "No Project"
            } / ${task.memberships?.[0]?.section?.name || "No Section"})`,
            value: task.gid!,
          }))}
          onSubmit={handleTasksSelect}
        />
      </Box>
    );
  }

  if (state.name === "status") {
    const task = state.selectedTasks[state.currentTaskIndex];
    if (!task) {
      return (
        <Box>
          <Spinner type="dots" />
          <Text> Loading...</Text>
        </Box>
      );
    }
    const project = task.memberships?.[0]?.project?.name || "No Project";
    const section = task.memberships?.[0]?.section?.name || "No Section";
    return (
      <Box>
        <Text>
          Status for "{task.name}" ({project} / {section}):{" "}
        </Text>
        <TextInput
          onSubmit={handleStatusSubmit}
          suggestions={["Complete", "In Progress", "Waiting"]}
        />
      </Box>
    );
  }

  if (state.name === "comment") {
    const task = state.selectedTasks[state.currentTaskIndex];
    if (!task) {
      return (
        <Box>
          <Spinner type="dots" />
          <Text> Loading...</Text>
        </Box>
      );
    }
    const project = task.memberships?.[0]?.project?.name || "No Project";
    const section = task.memberships?.[0]?.section?.name || "No Section";
    return (
      <Box>
        <Text>
          Comment for "{task.name}" ({project} / {section}):{" "}
        </Text>
        <TextInput onSubmit={handleCommentSubmit} />
      </Box>
    );
  }

  if (state.name === "postComment") {
    const task = state.selectedTasks[state.currentTaskIndex];
    if (!task) {
      return (
        <Box>
          <Spinner type="dots" />
          <Text> Loading...</Text>
        </Box>
      );
    }
    const project = task.memberships?.[0]?.project?.name || "No Project";
    const section = task.memberships?.[0]?.section?.name || "No Section";
    return (
      <Box>
        <Text>
          Post comment to "{task.name}" ({project} / {section})?{" "}
        </Text>
        <Select
          options={[
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
          ]}
          onChange={handlePostComment}
        />
      </Box>
    );
  }

  if (state.name === "postingComment") {
    return (
      <Box>
        <Spinner type="dots" />
        <Text> Posting comment...</Text>
      </Box>
    );
  }

  if (state.name === "summary") {
    return (
      <Box flexDirection="column">
        <Text>Tasks worked on today:</Text>
        <SummaryTable workedOnTasks={state.workedOnTasks} />
        <Box>
          <Text>Copy markdown output to clipboard? </Text>
          <Select
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            onChange={handleCopyToClipboard}
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box>
      <Spinner type="dots" />
      <Text> Loading...</Text>
    </Box>
  );
};

render(<App />);
