import { toast } from "sonner";
import { api } from "../api";
import type { QueueFullState } from "../types";
import { WorkerSlotCard } from "./WorkerSlotCard";

interface Props {
  state: QueueFullState;
  onRefresh: () => void;
}

export function Dashboard({ state, onRefresh }: Props) {
  const { running, slots, tasks } = state;

  const handleToggle = async () => {
    if (!running && tasks.length === 0) {
      toast.error("작업이 없습니다", { description: "작업 관리 탭에서 크롤링할 작업을 먼저 추가하세요." });
      return;
    }
    try {
      if (running) {
        await api.stopQueue();
      } else {
        await api.startQueue();
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
    <div className="flex flex-col gap-6">
      {/* 상단: 제어 버튼 + 요약 */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex gap-4 text-sm">
          <span className="text-gray-400">
            대기 <span className="text-white font-bold">{counts.idle}</span>
          </span>
          <span className="text-gray-400">
            실행 <span className="text-green-400 font-bold">{counts.running}</span>
          </span>
          <span className="text-gray-400">
            완료 <span className="text-purple-400 font-bold">{counts.completed}</span>
          </span>
          {counts.error > 0 && (
            <span className="text-gray-400">
              오류 <span className="text-red-400 font-bold">{counts.error}</span>
            </span>
          )}
        </div>
        <button
          onClick={handleToggle}
          className={`px-5 py-2 rounded-lg font-semibold text-sm transition-colors ${
            running
              ? "bg-red-600 hover:bg-red-500 text-white"
              : "bg-green-600 hover:bg-green-500 text-white"
          }`}
        >
          {running ? "⏹ 큐 정지" : "▶ 큐 시작"}
        </button>
      </div>

      {/* 슬롯 카드 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {slots.map((slot) => (
          <WorkerSlotCard key={slot.slotId} slot={slot} onRefresh={onRefresh} />
        ))}
      </div>

      {/* 전체 작업 요약 */}
      {tasks.length > 0 && (
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

function StatusDot({ status }: { status: string }) {
  const classes: Record<string, string> = {
    idle: "bg-gray-500",
    running: "bg-green-400 animate-pulse",
    completed: "bg-purple-400",
    error: "bg-red-400",
  };
  return <span className={`w-2 h-2 rounded-full ${classes[status] ?? "bg-gray-500"}`} />;
}
