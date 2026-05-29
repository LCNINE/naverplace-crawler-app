import { useState } from "react";
import type { Task } from "../types";
import type { ApiClient } from "../api";
import { TaskForm } from "./TaskForm";

interface Props {
  task: Task;
  onRefresh: () => void;
  onDragStart: (id: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (targetId: string) => void;
  apiClient: ApiClient;
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  idle: { label: "대기", cls: "bg-gray-700 text-gray-300" },
  running: { label: "실행 중", cls: "bg-green-900/60 text-green-300" },
  completed: { label: "완료", cls: "bg-purple-900/60 text-purple-300" },
  error: { label: "오류", cls: "bg-red-900/60 text-red-300" },
};

export function TaskCard({ task, onRefresh, onDragStart, onDragOver, onDrop, apiClient }: Props) {
  const [editing, setEditing] = useState(false);
  const isRunning = task.status === "running";
  const badge = STATUS_LABELS[task.status] ?? STATUS_LABELS.idle;

  const handleDelete = async () => {
    if (!confirm(`"${task.keyword}" 작업을 삭제하시겠습니까?`)) return;
    try {
      await apiClient.deleteTask(task.id);
      onRefresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handleReset = async () => {
    if (!confirm(`"${task.keyword}" 진행 상황을 초기화하시겠습니까?\n다음 실행 시 처음(서울 강남구)부터 다시 시작합니다.`)) return;
    try {
      await apiClient.resetProgress(task.id);
      onRefresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handleUpdate = async (data: Parameters<ApiClient["updateTask"]>[1]) => {
    await apiClient.updateTask(task.id, data);
    setEditing(false);
    onRefresh();
  };

  if (editing) {
    return (
      <div className="bg-gray-800 rounded-xl p-4 border border-blue-700/40">
        <p className="text-sm font-semibold text-gray-300 mb-3">작업 편집</p>
        <TaskForm
          initial={task}
          onSubmit={handleUpdate}
          onCancel={() => setEditing(false)}
          submitLabel="저장"
          apiClient={apiClient}
        />
      </div>
    );
  }

  return (
    <div
      draggable={!isRunning}
      onDragStart={() => onDragStart(task.id)}
      onDragOver={onDragOver}
      onDrop={() => onDrop(task.id)}
      className={`bg-gray-800 rounded-xl p-4 border transition-colors flex flex-col gap-2 ${
        isRunning ? "border-green-700/40" : "border-gray-700 cursor-grab active:cursor-grabbing"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {!isRunning && (
            <span className="text-gray-600 text-xs select-none shrink-0">⠿</span>
          )}
          <span className="font-semibold text-white text-sm truncate">{task.keyword}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${badge.cls}`}>
            {badge.label}
          </span>
        </div>
        <div className="flex gap-2 shrink-0">
          {!isRunning && (
            <>
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-gray-400 hover:text-white transition-colors"
              >
                편집
              </button>
              <button
                onClick={handleReset}
                className="text-xs text-yellow-400 hover:text-yellow-300 transition-colors"
              >
                리셋
              </button>
              <button
                onClick={handleDelete}
                className="text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                삭제
              </button>
            </>
          )}
        </div>
      </div>

      {task.extraCategoryKeywords.length > 0 && (
        <p className="text-xs text-gray-400">
          카테고리: {task.extraCategoryKeywords.join(", ")}
        </p>
      )}

      <div className="flex gap-4 text-xs text-gray-500">
        <span>테이블: {task.table}</span>
        <span>지연: {task.slowMo}ms</span>
        {task.collectMenu && <span>메뉴 수집</span>}
      </div>

      {task.dongsCompleted > 0 && (
        <p className="text-xs text-gray-500">{task.dongsCompleted.toLocaleString()}개 동 완료</p>
      )}

      {task.status === "error" && task.lastError && (
        <p className="text-xs text-red-400 truncate" title={task.lastError}>
          오류: {task.lastError}
        </p>
      )}
    </div>
  );
}
