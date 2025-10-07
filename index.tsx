import React, { useState, useEffect } from "react";
import { render, Box, Text } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
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
      name: "processTasks";
      client: ReturnType<typeof createClient<paths>>;
      tasks: Task[];
      workedOnTasks: WorkedOnTask[];
      currentTaskIndex: number;
    }
  | {
      name: "status";
      client: ReturnType<typeof createClient<paths>>;
      tasks: Task[];
      workedOnTasks: WorkedOnTask[];
      currentTaskIndex: number;
    }
  | {
      name: "comment";
      client: ReturnType<typeof createClient<paths>>;
      tasks: Task[];
      workedOnTasks: WorkedOnTask[];
      currentTaskIndex: number;
      status: string;
    }
  | {
      name: "postComment";
      client: ReturnType<typeof createClient<paths>>;
      tasks: Task[];
      workedOnTasks: WorkedOnTask[];
      currentTaskIndex: number;
      status: string;
      comment: string;
    }
  | { name: "summary"; workedOnTasks: WorkedOnTask[] }
  | { name: "exit" };

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
  const table = generateSummaryTable(workedOnTasks);
  return <Text>{table}</Text>;
};

const getTaskUrl = (task: Task) => {
  const projectGid = task.memberships?.[0]?.project?.gid;
  return projectGid
    ? `https://app.asana.com/0/${projectGid}/${task.gid}`
    : `https://app.asana.com/0/0/${task.gid}`;
};

const App = () => {
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
      state.client
        .GET("/tasks", {
          params: {
            query: {
              workspace: state.workspace,
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
        })
        .then(({ data }) => {
          if (data?.data) {
            const tasks = data.data as Task[];
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            const recent = tasks.filter((task) => {
              if (!task.modified_at) {
                return false;
              }
              const modifiedDate = new Date(task.modified_at);
              return modifiedDate >= sevenDaysAgo;
            });
            setState({
              name: "processTasks",
              client: state.client,
              tasks: recent,
              workedOnTasks: [],
              currentTaskIndex: 0,
            });
          } else {
            setError("Could not fetch tasks.");
          }
        });
    }
  }, [state, me]);

  const handlePatSubmit = (value: string) => {
    setPat(value);
  };

  const handleWorkspaceSelect = (item: { value: string }) => {
    if (state.name === "workspaces") {
      setState({
        name: "tasks",
        client: state.client,
        workspace: item.value,
      });
    }
  };

  const handleIncludeTask = (item: { value: string }) => {
    if (state.name === "processTasks") {
      if (item.value === "yes") {
        setState({
          name: "status",
          client: state.client,
          tasks: state.tasks,
          workedOnTasks: state.workedOnTasks,
          currentTaskIndex: state.currentTaskIndex,
        });
      } else {
        if (state.currentTaskIndex === state.tasks.length - 1) {
          setState({ name: "summary", workedOnTasks: state.workedOnTasks });
        } else {
          setState({
            ...state,
            currentTaskIndex: state.currentTaskIndex + 1,
          });
        }
      }
    }
  };

  const handleStatusSubmit = (value: string) => {
    if (state.name === "status") {
      setState({
        name: "comment",
        client: state.client,
        tasks: state.tasks,
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
        tasks: state.tasks,
        workedOnTasks: state.workedOnTasks,
        currentTaskIndex: state.currentTaskIndex,
        status: state.status,
        comment: value,
      });
    }
  };

  const handlePostComment = (item: { value: string }) => {
    if (state.name === "postComment") {
      const task = state.tasks[state.currentTaskIndex];
      if (!task) {
        return;
      }
      if (item.value === "yes") {
        state.client.POST("/tasks/{task_gid}/stories", {
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
      }
      const newWorkedOnTasks = [
        ...state.workedOnTasks,
        {
          task,
          status: state.status,
          comment: state.comment,
        },
      ];
      if (state.currentTaskIndex === state.tasks.length - 1) {
        setState({ name: "summary", workedOnTasks: newWorkedOnTasks });
      } else {
        setState({
          name: "processTasks",
          client: state.client,
          tasks: state.tasks,
          workedOnTasks: newWorkedOnTasks,
          currentTaskIndex: state.currentTaskIndex + 1,
        });
      }
    }
  };

  const handleCopyToClipboard = (item: { value: string }) => {
    if (item.value === "yes" && state.name === "summary") {
      const table = generateSummaryTable(state.workedOnTasks);
      clipboardy.writeSync(table);
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
        <TextInput
          value={pat}
          onChange={setPat}
          onSubmit={handlePatSubmit}
        />
      </Box>
    );
  }

  if (state.name === "workspaces") {
    return (
      <Box>
        <Text>Select a workspace: </Text>
        <SelectInput
          items={workspaces.map((w) => ({ label: w.name!, value: w.gid! }))}
          onSelect={handleWorkspaceSelect}
        />
      </Box>
    );
  }

  if (state.name === "tasks") {
    return <Text>Fetching tasks...</Text>;
  }

  if (state.name === "processTasks") {
    const task = state.tasks[state.currentTaskIndex];
    if (!task) {
      return <Text>Loading...</Text>;
    }
    const project = task.memberships?.[0]?.project?.name || "No Project";
    const section = task.memberships?.[0]?.section?.name || "No Section";
    return (
      <Box>
        <Text>
          Add "{task.name}" ({project} / {section}) to the list of tasks worked
          on today?
        </Text>
        <SelectInput
          items={[
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
          ]}
          onSelect={handleIncludeTask}
        />
      </Box>
    );
  }

  if (state.name === "status") {
    return (
      <Box>
        <Text>Status: </Text>
        <TextInput
          value=""
          onChange={() => {}}
          onSubmit={handleStatusSubmit}
        />
      </Box>
    );
  }

  if (state.name === "comment") {
    return (
      <Box>
        <Text>Comment: </Text>
        <TextInput
          value=""
          onChange={() => {}}
          onSubmit={handleCommentSubmit}
        />
      </Box>
    );
  }

  if (state.name === "postComment") {
    return (
      <Box>
        <Text>Post comment to Asana? </Text>
        <SelectInput
          items={[
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
          ]}
          onSelect={handlePostComment}
        />
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
          <SelectInput
            items={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            onSelect={handleCopyToClipboard}
          />
        </Box>
      </Box>
    );
  }

  return <Text>Loading...</Text>;
};

render(<App />);