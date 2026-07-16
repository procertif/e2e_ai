export interface Test {
  filename: string;
  name: string;
  alias?: string;
  type: string;
  typeLabel: string;
  estimatedMs?: number;
  environmentId?: number | null;
  environmentName?: string | null;
}

export interface Group {
  id: string;
  name: string;
  tests: string[];
}

export interface ScenarioAction {
  index: number;
  line: number;
  description: string;
}

export interface ScenarioData {
  test: string;
  file: string;
  actions: ScenarioAction[];
}

export interface EnvironmentVariable {
  key: string;
  value: string;
  description: string | null;
}

export interface Environment {
  id: number;
  name: string;
  url: string;
  variables: EnvironmentVariable[];
  color: string;
  branch: string | null;
  lastFetchedCommit: string | null;
  hasUpdate: boolean;
}

export interface CampaignTest {
  filename: string;
  status: "idle" | "passed" | "failed";
  output?: string;
}

export interface Campaign {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  environmentId: number | null;
  environmentName: string | null;
  durationMs: number | null;
  tests: CampaignTest[];
  passed: number;
  failed: number;
  total: number;
}

export interface PendingCorrectionSummary {
  filename: string;
  campaignId: string;
  campaignTitle: string | null;
  createdAt: number;
  environmentId: number | null;
  aiEdited: boolean;
  userEdited: boolean;
  lastRunStatus: "passed" | "failed" | null;
  lastRunWasEdited: boolean;
}

export interface PendingCorrection extends PendingCorrectionSummary {
  originalContent: string;
  draftContent: string;
  consoleOutput: string;
  environmentId: number | null;
  environmentName: string | null;
  chatMessages: unknown[];
}

export interface ConversationSummary {
  conversationId: string;
  latestChatLogId: number;
  latestRunId: string;
  updatedAt: string;
  title: string | null;
  messageCount: number;
}
