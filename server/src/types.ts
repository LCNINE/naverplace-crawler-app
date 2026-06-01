export type TaskStatus = "idle" | "running" | "completed" | "error";

export interface Task {
  id: string;
  keyword: string;
  table: string;
  /** v3 canonical category 키. 없으면 table 에서 _v{n} 제거해 유도. */
  category?: string;
  slowMo: number;
  collectMenu: boolean;
  extraCategoryKeywords: string[];
  order: number;
  status: TaskStatus;
  dongsCompleted: number;
  workerSlotId?: number;
  startedAt?: string;
  lastError?: string;
  updatedAt: string;
}

export interface QueueState {
  version: 2;
  running: boolean;
  tasks: Task[];
}

export interface SlotInfo {
  slotId: number;
  taskId: string | null;
  keyword: string | null;
  status: "idle" | "running";
  currentCity?: string;
  currentDistrict?: string;
  currentDong?: string;
  currentPage?: number;
  dongsCompleted?: number;
  startedAt?: string;
}
