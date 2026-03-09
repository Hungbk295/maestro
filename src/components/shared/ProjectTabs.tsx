import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { Minus, PanelLeft, Plus, Square, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProjectStatus, STATUS_COLORS } from "@/hooks/useProjectStatus";
import { isMac } from "@/lib/platform";
import type { TabColor } from "@/stores/useWorkspaceStore";

export type ProjectTab = {
  id: string;
  name: string;
  active: boolean;
  tabColor?: TabColor;
};

/** 7 selectable tab colors + default (no tint). */
const TAB_COLORS: { key: TabColor; label: string; swatch: string; bg: string; text: string; border: string }[] = [
  { key: "default", label: "Default",  swatch: "bg-maestro-muted",    bg: "",                            text: "",                    border: "" },
  { key: "red",     label: "Red",      swatch: "bg-red-500",          bg: "bg-red-500/15",               text: "text-red-400",        border: "border-red-500/40" },
  { key: "orange",  label: "Orange",   swatch: "bg-orange-500",       bg: "bg-orange-500/15",            text: "text-orange-400",     border: "border-orange-500/40" },
  { key: "yellow",  label: "Yellow",   swatch: "bg-yellow-500",       bg: "bg-yellow-500/15",            text: "text-yellow-400",     border: "border-yellow-500/40" },
  { key: "green",   label: "Green",    swatch: "bg-emerald-500",      bg: "bg-emerald-500/15",           text: "text-emerald-400",    border: "border-emerald-500/40" },
  { key: "blue",    label: "Blue",     swatch: "bg-blue-500",         bg: "bg-blue-500/15",              text: "text-blue-400",       border: "border-blue-500/40" },
  { key: "purple",  label: "Purple",   swatch: "bg-purple-500",       bg: "bg-purple-500/15",            text: "text-purple-400",     border: "border-purple-500/40" },
  { key: "pink",    label: "Pink",     swatch: "bg-pink-500",         bg: "bg-pink-500/15",              text: "text-pink-400",       border: "border-pink-500/40" },
];

interface ProjectTabsProps {
  tabs: ProjectTab[];
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  onReorderTab: (activeId: string, overId: string) => void;
  onMoveTab: (tabId: string, direction: "left" | "right") => void;
  onSetTabColor: (tabId: string, color: TabColor) => void;
}

/**
 * Individual tab component that uses the useProjectStatus hook.
 */
function TabColorMenu({
  tabId,
  currentColor,
  position,
  onSelect,
  onClose,
}: {
  tabId: string;
  currentColor: TabColor;
  position: { x: number; y: number };
  onSelect: (tabId: string, color: TabColor) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 rounded-lg border border-maestro-border bg-maestro-surface p-1.5 shadow-elevation-3"
      style={{ left: position.x, top: position.y }}
    >
      <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-maestro-muted">
        Tab Color
      </div>
      <div className="flex items-center gap-1 px-1 py-1">
        {TAB_COLORS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => {
              onSelect(tabId, c.key);
              onClose();
            }}
            className={`group relative h-5 w-5 rounded-full ${c.swatch} transition-all hover:scale-125 ${
              currentColor === c.key
                ? "ring-2 ring-maestro-text ring-offset-1 ring-offset-maestro-surface"
                : ""
            }`}
            aria-label={c.label}
            title={c.label}
          >
            {c.key === "default" && currentColor === "default" && (
              <span className="absolute inset-0 flex items-center justify-center text-[8px] text-maestro-text font-bold">
                &times;
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function TabItem({
  tab,
  onSelect,
  onClose,
  onKeyDown,
  onSetColor,
  tabRefCallback,
}: {
  tab: ProjectTab;
  onSelect: () => void;
  onClose: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onSetColor: (tabId: string, color: TabColor) => void;
  tabRefCallback: (node: HTMLElement | null) => void;
}) {
  const { status, sessionCount } = useProjectStatus(tab.id);
  const shouldPulse = status === "working" || status === "needs-input";
  const [colorMenu, setColorMenu] = useState<{ x: number; y: number } | null>(null);

  const colorDef = TAB_COLORS.find((c) => c.key === (tab.tabColor ?? "default")) ?? TAB_COLORS[0];
  const hasColor = colorDef.key !== "default";

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id });

  const combinedRef = useCallback(
    (node: HTMLElement | null) => {
      setNodeRef(node);
      tabRefCallback(node);
    },
    [setNodeRef, tabRefCallback],
  );

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setColorMenu({ x: e.clientX, y: e.clientY });
  }, []);

  return (
    <>
      <div
        ref={combinedRef}
        style={style}
        {...attributes}
        {...listeners}
        role="tab"
        aria-selected={tab.active}
        tabIndex={tab.active ? 0 : -1}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        onContextMenu={handleContextMenu}
        className={`flex items-center gap-1.5 rounded-t px-2 py-1.5 text-xs font-medium cursor-pointer border-b-2 transition-colors ${
          hasColor
            ? `${colorDef.bg} ${tab.active ? colorDef.text : ""} ${colorDef.border}`
            : `border-transparent ${
                tab.active
                  ? "bg-maestro-bg text-maestro-text"
                  : "text-maestro-muted hover:text-maestro-text"
              }`
        } ${tab.active && !hasColor ? "" : ""}`}
      >
        <span className="flex items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full ${STATUS_COLORS[status]} ${
              shouldPulse ? "animate-pulse" : ""
            }`}
          />
          <span>{tab.name}</span>
          {sessionCount > 0 && (
            <span
              className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                status === "working"
                  ? "bg-maestro-accent/20 text-maestro-accent"
                  : status === "needs-input"
                    ? "bg-yellow-500/20 text-yellow-500"
                    : "bg-maestro-muted/20 text-maestro-muted"
              }`}
            >
              {sessionCount}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="ml-1 rounded p-0.5 hover:bg-maestro-border"
          aria-label={`Close ${tab.name}`}
        >
          <X size={10} />
        </button>
      </div>
      {colorMenu && (
        <TabColorMenu
          tabId={tab.id}
          currentColor={tab.tabColor ?? "default"}
          position={colorMenu}
          onSelect={onSetColor}
          onClose={() => setColorMenu(null)}
        />
      )}
    </>
  );
}

export function ProjectTabs({
  tabs,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onToggleSidebar,
  sidebarOpen,
  onReorderTab,
  onMoveTab,
  onSetTabColor,
}: ProjectTabsProps) {
  const appWindow = useMemo(() => getCurrentWindow(), []);

  // Ref map for focus management (WAI-ARIA tablist keyboard navigation)
  const tabRefs = useRef(new Map<string, HTMLElement>());
  const setTabRef = useCallback((id: string) => (node: HTMLElement | null) => {
    if (node) {
      tabRefs.current.set(id, node);
    } else {
      tabRefs.current.delete(id);
    }
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        onReorderTab(active.id as string, over.id as string);
      }
    },
    [onReorderTab]
  );

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent, tab: ProjectTab) => {
      const isMeta = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl+Shift+Arrow: move tab position
      if (isMeta && e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        onMoveTab(tab.id, e.key === "ArrowLeft" ? "left" : "right");
        return;
      }

      // Arrow keys: switch tab focus
      if (e.key === "ArrowRight") {
        const idx = tabs.findIndex((t) => t.id === tab.id);
        const next = tabs[(idx + 1) % tabs.length];
        if (next) {
          onSelectTab(next.id);
          tabRefs.current.get(next.id)?.focus();
        }
      } else if (e.key === "ArrowLeft") {
        const idx = tabs.findIndex((t) => t.id === tab.id);
        const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
        if (prev) {
          onSelectTab(prev.id);
          tabRefs.current.get(prev.id)?.focus();
        }
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelectTab(tab.id);
      }
    },
    [tabs, onSelectTab, onMoveTab]
  );

  return (
    <div
      data-tauri-drag-region
      className="theme-transition no-select flex h-9 items-center border-b border-maestro-border bg-maestro-surface"
    >
      {/* Left: sidebar toggle + tabs (inset from CSS var for macOS traffic lights) */}
      <div
        className="flex items-center gap-0.5 pr-1.5"
        style={{ paddingLeft: "max(var(--mac-title-bar-inset, 0px), 6px)" }}
      >
        <button
          type="button"
          onClick={onToggleSidebar}
          className={`rounded p-1.5 transition-colors ${
            sidebarOpen
              ? "text-maestro-accent hover:bg-maestro-accent/10"
              : "text-maestro-muted hover:bg-maestro-border hover:text-maestro-text"
          }`}
          aria-label="Toggle sidebar"
        >
          <PanelLeft size={14} />
        </button>

        <div className="mx-1 h-4 w-px bg-maestro-border" />

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToHorizontalAxis]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={tabs.map((t) => t.id)}
            strategy={horizontalListSortingStrategy}
          >
            <div role="tablist" aria-label="Open projects" className="flex items-center gap-0.5">
              {tabs.length === 0 ? (
                <span className="px-2 text-xs text-maestro-muted">No projects</span>
              ) : (
                tabs.map((tab) => (
                  <TabItem
                    key={tab.id}
                    tab={tab}
                    onSelect={() => onSelectTab(tab.id)}
                    onClose={() => onCloseTab(tab.id)}
                    onKeyDown={(e) => handleTabKeyDown(e, tab)}
                    onSetColor={onSetTabColor}
                    tabRefCallback={setTabRef(tab.id)}
                  />
                ))
              )}
            </div>
          </SortableContext>
        </DndContext>

        <button
          type="button"
          onClick={onNewTab}
          className="rounded p-1 text-maestro-muted hover:bg-maestro-border hover:text-maestro-text"
          aria-label="Open new project"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Center: drag region fills remaining space */}
      <div data-tauri-drag-region className="flex-1" />

      {/* Right: window controls (hidden on macOS — custom traffic lights in row instead) */}
      {!isMac() && (
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => appWindow.minimize()}
            className="flex h-9 w-11 items-center justify-center text-maestro-muted transition-colors hover:bg-maestro-muted/10 hover:text-maestro-text"
            aria-label="Minimize"
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            onClick={() => appWindow.toggleMaximize()}
            className="flex h-9 w-11 items-center justify-center text-maestro-muted transition-colors hover:bg-maestro-muted/10 hover:text-maestro-text"
            aria-label="Maximize"
          >
            <Square size={12} />
          </button>
          <button
            type="button"
            onClick={() => appWindow.close()}
            className="flex h-9 w-11 items-center justify-center text-maestro-muted transition-colors hover:bg-maestro-red/80 hover:text-white"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
