import type { SlotInfo } from "../types";
import { api } from "../api";

interface Props {
  slot: SlotInfo;
  onRefresh: () => void;
}

export function WorkerSlotCard({ slot, onRefresh }: Props) {
  const handleStop = async () => {
    try {
      await api.stopSlot(slot.slotId);
      onRefresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  if (slot.status === "idle") {
    return (
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500 font-mono">슬롯 {slot.slotId}</span>
          <span className="w-2.5 h-2.5 rounded-full bg-gray-600" />
        </div>
        <p className="text-gray-500 text-sm mt-2">대기 중</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-green-700/40 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400 font-mono">슬롯 {slot.slotId}</span>
        <span className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse" />
      </div>
      <p className="text-white font-semibold text-base truncate">{slot.keyword ?? "—"}</p>
      {slot.currentCity && (
        <p className="text-gray-400 text-sm">
          {slot.currentCity} {slot.currentDistrict} {slot.currentDong}
          {slot.currentPage && slot.currentPage > 1 ? ` · ${slot.currentPage}페이지` : ""}
        </p>
      )}
      {slot.dongsCompleted !== undefined && (
        <p className="text-gray-500 text-xs">{slot.dongsCompleted.toLocaleString()}개 동 완료</p>
      )}
      {slot.startedAt && (
        <p className="text-gray-600 text-xs">{new Date(slot.startedAt).toLocaleTimeString()} 시작</p>
      )}
      <button
        onClick={handleStop}
        className="mt-1 text-xs text-red-400 hover:text-red-300 text-left"
      >
        정지
      </button>
    </div>
  );
}
