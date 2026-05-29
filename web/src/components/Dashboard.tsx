import { toast } from "sonner";
import type { ApiClient } from "../api";
import type { QueueFullState } from "../types";
import { WorkerSlotCard } from "./WorkerSlotCard";

interface ContainerPanelProps {
  label: string;
  state: QueueFullState;
  onRefresh: () => void;
  apiClient: ApiClient;
  showTasks?: boolean;
}

function ContainerPanel({ label, state, onRefresh, apiClient, showTasks }: ContainerPanelProps) {
  const { running, slots, tasks } = state;

  const handleToggle = async () => {
    if (!running && tasks.length === 0) {
      toast.error("작업이 없습니다", { description: "작업 관리 탭에서 크롤링할 작업을 먼저 추가하세요." });
      return;
    }
    try {
      if (running) {
        await apiClient.stopQueue();
      } else {
        await apiClient.startQueue();
      }
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const counts = {
    idle: tasks.filter((t) => t.status === "idle").length,
    running: tasks.filter((t) => t.status === "running").length,
    completed: tasks.filter((t) => t.status === "completed").length,
    error: tasks.filter((t) => t.status === "error").length,
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 컨테이너 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-300">{label}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${running ? "bg-green-900/60 text-green-300" : "bg-gray-700 text-gray-400"}`}>
            {running ? "실행 중" : "정지"}
          </span>
          <div className="flex gap-3 text-xs text-gray-400">
            <span>대기 <span className="text-white font-bold">{counts.idle}</span></span>
            <span>실행 <span className="text-green-400 font-bold">{counts.running}</span></span>
            <span>완료 <span className="text-purple-400 font-bold">{counts.completed}</span></span>
            {counts.error > 0 && (
              <span>오류 <span className="text-red-400 font-bold">{counts.error}</span></span>
            )}
          </div>
        </div>
        <button
          onClick={handleToggle}
          className={`px-4 py-1.5 rounded-lg font-semibold text-sm transition-colors ${
            running
              ? "bg-red-600 hover:bg-red-500 text-white"
              : "bg-green-600 hover:bg-green-500 text-white"
          }`}
        >
          {running ? "⏹ 정지" : "▶ 시작"}
        </button>
      </div>

      {/* 슬롯 카드 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {slots.map((slot) => (
          <WorkerSlotCard key={slot.slotId} slot={slot} onRefresh={onRefresh} apiClient={apiClient} />
        ))}
      </div>

      {/* 작업 현황 (컨테이너 1만 표시) */}
      {showTasks && tasks.length > 0 && (
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">작업 현황</h3>
          <div className="space-y-2">
            {tasks.map((task) => (
              <div key={task.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <StatusDot status={task.status} />
                  <span className="text-white">{task.keyword}</span>
                  {task.extraCategoryKeywords.length > 0 && (
                    <span className="text-gray-500 text-xs">
                      ({task.extraCategoryKeywords.join(", ")})
                    </span>
                  )}
                </div>
                <span className="text-gray-500 text-xs">
                  {task.dongsCompleted > 0 ? `${task.dongsCompleted.toLocaleString()}동 완료` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface Props {
  state: QueueFullState;
  onRefresh: () => void;
  apiClient: ApiClient;
  state2?: QueueFullState | null;
  onRefresh2?: () => void;
  apiClient2?: ApiClient | null;
}

export function Dashboard({ state, onRefresh, apiClient, state2, onRefresh2, apiClient2 }: Props) {
  const hasContainer2 = !!apiClient2;

  return (
    <div className="flex flex-col gap-8">
      <ContainerPanel
        label={hasContainer2 ? "컨테이너 1" : "슬롯 현황"}
        state={state}
        onRefresh={onRefresh}
        apiClient={apiClient}
        showTasks
      />

      {hasContainer2 && (
        <>
          <hr className="border-gray-700" />
          {state2 ? (
            <ContainerPanel
              label="컨테이너 2"
              state={state2}
              onRefresh={onRefresh2 ?? (() => {})}
              apiClient={apiClient2}
            />
          ) : (
            <div className="text-center py-8 text-gray-500 text-sm">컨테이너 2 연결 중...</div>
          )}
        </>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const classes: Record<string, string> = {
    idle: "bg-gray-500",
    running: "bg-green-400 animate-pulse",
    completed: "bg-purple-400",
    error: "bg-red-400",
  };
  return <span className={`w-2 h-2 rounded-full ${classes[status] ?? "bg-gray-500"}`} />;
}
