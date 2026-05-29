import { useState, useRef } from "react";
import type { Task } from "../types";
import type { ApiClient } from "../api";
import { TaskCard } from "./TaskCard";
import { TaskForm } from "./TaskForm";

interface Props {
  tasks: Task[];
  onRefresh: () => void;
  apiClient: ApiClient;
}

export function TaskManager({ tasks, onRefresh, apiClient }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const dragId = useRef<string | null>(null);

  const handleAdd = async (data: Parameters<ApiClient["addTask"]>[0]) => {
    await apiClient.addTask(data);
    setShowAdd(false);
    onRefresh();
  };

  const handleDragStart = (id: string) => {
    dragId.current = id;
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (targetId: string) => {
    if (!dragId.current || dragId.current === targetId) return;
    const ids = tasks.map((t) => t.id);
    const fromIdx = ids.indexOf(dragId.current);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, dragId.current);
    dragId.current = null;
    try {
      await apiClient.reorderTasks(ids);
      onRefresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">
          작업 {tasks.length}개 · 드래그해서 순서 변경 (실행 중인 작업 제외)
        </p>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold transition-colors"
        >
          + 작업 추가
        </button>
      </div>

      {showAdd && (
        <div className="bg-gray-800 rounded-xl p-4 border border-blue-700/40">
          <p className="text-sm font-semibold text-gray-300 mb-3">새 작업 추가</p>
          <TaskForm onSubmit={handleAdd} onCancel={() => setShowAdd(false)} submitLabel="추가" apiClient={apiClient} />
        </div>
      )}

      {tasks.length === 0 && !showAdd && (
        <div className="text-center py-12 text-gray-500">
          <p>작업이 없습니다.</p>
          <p className="text-sm mt-1">상단 "작업 추가" 버튼으로 추가하세요.</p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onRefresh={onRefresh}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            apiClient={apiClient}
          />
        ))}
      </div>
    </div>
  );
}
