import { useState } from "react";
import {
  Heart,
  Images,
  Play,
  Search,
  Settings,
  Film,
  FolderOpen,
  Trash2,
  Star,
  Clock,
  CopyPlus,
  Folder,
  ArrowDownUp,
  CheckSquare,
  HardDrive,
} from "lucide-react";
import { PillButton } from "@/components/ui/PillButton";
import { IconButton } from "@/components/ui/IconButton";
import { Chip } from "@/components/ui/Chip";
import { Segmented } from "@/components/ui/Segmented";
import { GlassTopBar, TopBarTitle } from "@/components/ui/GlassTopBar";
import { SidebarRail, type SidebarItem } from "@/components/ui/SidebarRail";
import { ScrollArea } from "@/components/ui/ScrollArea";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/Dialog";
import {
  Menu,
  MenuTrigger,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuLabel,
} from "@/components/ui/Menu";
import { toast } from "@/components/ui/Toast";

const viewOptions = [
  { value: "justified", label: "Justified" },
  { value: "masonry", label: "Masonry" },
  { value: "square", label: "Square" },
  { value: "list", label: "List" },
] as const;

type ViewMode = (typeof viewOptions)[number]["value"];

const sidebarItems: SidebarItem[] = [
  { id: "sd", label: "SD CARD", icon: <HardDrive />, capacity: { ratio: 0.42, caption: "212 GB free / 512 GB" } },
  { id: "photos", label: "Photos", icon: <FolderOpen />, badge: "12,482" },
  { id: "favorites", label: "Favorites", icon: <Heart />, badge: "348" },
  { id: "albums", label: "Albums", icon: <Images />, badge: "12" },
  { id: "videos", label: "Videos", icon: <Film />, badge: "1,204" },
  { id: "recents", label: "Recents", icon: <Clock /> },
  { id: "trash", label: "Trash", icon: <Trash2 />, badge: "23" },
];

const swatches: { name: string; css: string; note: string }[] = [
  { name: "canvas", css: "var(--canvas)", note: "#0A0A0C" },
  { name: "surface-1", css: "var(--surface-1)", note: "#121216" },
  { name: "surface-2", css: "var(--surface-2)", note: "#1A1A20" },
  { name: "border", css: "transparent", note: "white / 6%" },
  { name: "border-hover", css: "transparent", note: "white / 12%" },
  { name: "text-primary", css: "var(--text-primary)", note: "#F2F2F4" },
  { name: "text-secondary", css: "var(--text-secondary)", note: "62%" },
  { name: "text-tertiary", css: "var(--text-tertiary)", note: "38%" },
  { name: "accent", css: "var(--accent)", note: "#6EC1FF — interactive + progress only" },
  { name: "success", css: "var(--success)", note: "#3ECF8E" },
  { name: "danger", css: "var(--danger)", note: "#FF5C5C" },
  { name: "warning", css: "var(--warning)", note: "#F5B85C" },
];

function Section({
  index,
  title,
  children,
}: {
  index: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-16">
      <div className="mb-5 flex items-baseline gap-3">
        <span className="font-mono text-[11px] tracking-[0.12em] text-accent">
          {index}
        </span>
        <h2 className="text-base font-semibold text-tprimary">{title}</h2>
      </div>
      <div className="flex flex-wrap items-start gap-8">{children}</div>
    </section>
  );
}

function SectionsDemo({
  view,
  setView,
}: {
  view: ViewMode;
  setView: (v: ViewMode) => void;
}) {
  return (
    <>
      {/* 01 — Color */}
      <Section index="01" title="Color tokens">
        <div className="grid w-full grid-cols-4 gap-2">
          {swatches.map((s) => (
            <div key={s.name} className="rounded-card border border-hairline p-2">
              <div
                className="h-12 w-full rounded-control border border-hairline"
                style={{
                  background: s.css,
                  backgroundImage: s.name.startsWith("border")
                    ? "repeating-linear-gradient(45deg, rgba(255,255,255,.06) 0 1px, transparent 1px 6px)"
                    : undefined,
                }}
              />
              <div className="mt-2 font-mono text-[11px] text-tprimary">{s.name}</div>
              <div className="font-mono text-[10px] text-ttertiary">{s.note}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* 02 — Typography */}
      <Section index="02" title="Typography">
        <div className="w-full">
          <div className="mb-1 text-xl font-semibold text-tprimary">H1 — 20px / 600</div>
          <div className="mb-1 text-sm text-tprimary">
            Body — 14px / 400, line-height 1.55. Inter Variable for all UI text.
          </div>
          <div className="mb-3 text-sm text-tsecondary">
            Secondary text — 62% white for supporting copy.
          </div>
          <div className="micro-label">Micro-label — 11px mono uppercase ls .12em</div>
          <div className="mt-2 font-mono text-sm text-tprimary">
            JetBrains Mono — 12,482 items · 00:04:32 · 3840×2160 · 60fps
          </div>
        </div>
      </Section>

      {/* 03 — Buttons */}
      <Section index="03" title="Buttons — pill, primary / ghost / icon">
        <PillButton onClick={() => toast.success("Primary action")}>Primary</PillButton>
        <PillButton variant="ghost">Ghost</PillButton>
        <PillButton variant="danger">Danger</PillButton>
        <IconButton label="Favorite" onClick={() => toast("Favorited")}>
          <Heart size={16} />
        </IconButton>
        <IconButton label="Search">
          <Search size={16} />
        </IconButton>
        <PillButton disabled>Disabled</PillButton>
      </Section>

      {/* 04 — Chips */}
      <Section index="04" title="Chips">
        <Chip>Type chip</Chip>
        <Chip mono>00:04:32</Chip>
        <Chip mono>3840×2160</Chip>
        <Chip mono accent>
          H.264 · 60FPS
        </Chip>
        <Chip className="text-success">Success</Chip>
        <Chip className="text-danger">Danger</Chip>
      </Section>

      {/* 05 — Segmented */}
      <Section index="05" title="Segmented control">
        <Segmented
          aria-label="Demo view mode"
          options={viewOptions.map((o) => ({ ...o }))}
          value={view}
          onChange={setView}
        />
        <span className="micro-label">Selected: {view}</span>
      </Section>
    </>
  );
}

function ExtraSections() {
  return (
    <>
      {/* 06 — Dialog & Menu */}
      <Section index="06" title="Dialog & Menu">
        <Dialog>
          <DialogTrigger asChild>
            <PillButton variant="ghost">Open dialog</PillButton>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add library</DialogTitle>
              <DialogDescription>
                Choose a folder or drive to scan. LUMEN never copies your files —
                everything stays in place.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center justify-center rounded-control border border-dashed border-hairline-hover py-10">
              <span className="micro-label">Drop folder here</span>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <PillButton variant="ghost">Cancel</PillButton>
              <PillButton>Add</PillButton>
            </div>
          </DialogContent>
        </Dialog>

        <Menu>
          <MenuTrigger asChild>
            <PillButton variant="ghost">Open menu</PillButton>
          </MenuTrigger>
          <MenuContent>
            <MenuLabel>Actions</MenuLabel>
            <MenuItem>
              <Heart size={14} /> Favorite
            </MenuItem>
            <MenuItem>
              <CopyPlus size={14} /> Add to album
            </MenuItem>
            <MenuItem>
              <Play size={14} /> Collage
            </MenuItem>
            <MenuItem>
              <Folder size={14} /> Open containing folder
            </MenuItem>
            <MenuSeparator />
            <MenuItem className="text-danger">
              <Trash2 size={14} /> Move to trash
            </MenuItem>
          </MenuContent>
        </Menu>
      </Section>

      {/* 07 — Empty / loading / progress */}
      <Section index="07" title="Empty state · Loading · Progress">
        <div className="flex w-full flex-col gap-6">
          <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-hairline-hover py-12">
            <span className="micro-label">No items yet</span>
          </div>
          <div className="flex gap-2">
            <div className="shimmer-bg h-24 flex-1 rounded-card" />
            <div className="shimmer-bg h-24 flex-1 rounded-card" />
            <div className="shimmer-bg h-24 flex-1 rounded-card" />
          </div>
          <div>
            <div className="mb-2 flex justify-between">
              <span className="micro-label">Scan progress</span>
              <span className="font-mono text-[11px] text-ttertiary">3,412 / 12,482</span>
            </div>
            <div className="h-0.5 w-full rounded-pill bg-surface-2">
              <div className="h-full w-[27%] rounded-pill bg-accent" />
            </div>
          </div>
        </div>
      </Section>

      {/* 08 — Status line */}
      <Section index="08" title="Status line (mono)">
        <span className="font-mono text-[11px] text-ttertiary">
          12,482 items - 348 GB - scanned 2s ago
        </span>
      </Section>
    </>
  );
}

/** Hidden living style sheet: /#/style */
export default function StylePage() {
  const [view, setView] = useState<ViewMode>("justified");

  return (
    <div className="relative flex h-full">
      <SidebarRail
        items={sidebarItems}
        bottom={
          <div className="flex flex-col gap-2">
            <button className="flex h-8 w-full items-center gap-2.5 rounded-control px-2 text-left text-[13px] text-tsecondary transition-colors hover:bg-surface-2 hover:text-tprimary">
              <Settings size={16} />
              Settings
            </button>
            <div className="px-2 font-mono text-[10px] leading-relaxed text-ttertiary">
              SCANNING… 3,412 / 12,482
            </div>
          </div>
        }
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <GlassTopBar
          left={<TopBarTitle title="Style" count="DESIGN SYSTEM" />}
          right={
            <>
              <Segmented
                aria-label="View mode"
                options={viewOptions.map((o) => ({ ...o }))}
                value={view}
                onChange={setView}
              />
              <Menu>
                <MenuTrigger asChild>
                  <IconButton label="Sort">
                    <ArrowDownUp size={16} />
                  </IconButton>
                </MenuTrigger>
                <MenuContent>
                  <MenuLabel>Sort by</MenuLabel>
                  <MenuItem>Date captured</MenuItem>
                  <MenuItem>Name</MenuItem>
                  <MenuItem>Size</MenuItem>
                  <MenuItem>Duration</MenuItem>
                  <MenuSeparator />
                  <MenuItem>Ascending</MenuItem>
                  <MenuItem>Descending</MenuItem>
                </MenuContent>
              </Menu>
              <IconButton label="Selection mode">
                <CheckSquare size={16} />
              </IconButton>
            </>
          }
        />

        <ScrollArea className="relative flex-1 px-6 py-8">
          <div className="mx-auto max-w-3xl">
            <h1 className="mb-1 text-xl font-semibold text-tprimary">LUMEN Design System</h1>
            <p className="mb-12 text-sm text-tsecondary">
              Living style sheet — every token and base component, per docs/DESIGN.md.
            </p>
            <SectionsDemo view={view} setView={setView} />
            <ExtraSections />
            <div className="h-12" />
          </div>
        </ScrollArea>

        {/* floating glass action bar demo */}
        <div className="pointer-events-none absolute bottom-6 left-1/2 z-40 -translate-x-1/2">
          <div className="glass pointer-events-auto flex items-center gap-1 rounded-pill border border-hairline px-2 py-1.5 shadow-popover">
            <IconButton label="Favorite">
              <Heart size={16} />
            </IconButton>
            <IconButton label="Add to album">
              <Images size={16} />
            </IconButton>
            <IconButton label="Collage">
              <Star size={16} />
            </IconButton>
            <IconButton label="Open containing folder">
              <Folder size={16} />
            </IconButton>
            <IconButton label="Trash" className="text-danger">
              <Trash2 size={16} />
            </IconButton>
          </div>
        </div>

        {/* bottom-left status line */}
        <div className="pointer-events-none absolute bottom-5 left-6 font-mono text-[11px] text-ttertiary">
          12,482 items - 348 GB - scanned 2s ago
        </div>
      </div>
    </div>
  );
}
