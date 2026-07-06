export interface Test {
  filename: string;
  name: string;
  alias?: string;
  type: string;
  typeLabel: string;
  estimatedMs?: number;
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
