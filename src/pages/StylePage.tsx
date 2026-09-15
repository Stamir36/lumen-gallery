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
import { GlassCard } from "@/components/ui/GlassCard";
import { FAB } from "@/components/ui/FAB";
import { Slider } from "@/components/ui/Slider";
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
  { name: "surface-1", css: "var(--surface-1)", note: "#141518" },
  { name: "surface-2", css: "var(--surface-2)", note: "#1E2023" },
  { name: "surface-3", css: "var(--surface-3)", note: "#26282C" },
  { name: "text-primary", css: "var(--text-primary)", note: "#F2F2F4" },
  { name: "text-secondary", css: "var(--text-secondary)", note: "62%" },
  { name: "text-tertiary", css: "var(--text-tertiary)", note: "38%" },
  { name: "accent", css: "var(--accent)", note: "#6EC1FF" },
  { name: "success", css: "var(--success)", note: "#3ECF8E" },
  { name: "danger", css: "var(--danger)", note: "#FF5C5C" },
  { name: "warning", css: "var(--warning)", note: "#F5B85C" },
];

/** editorial section: oversized thin accent number + section title */
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
      <div className="mb-8 flex items-center gap-5">
        <span className="font-sans text-3xl font-light text-accent">{index}</span>
        <h2 className="text-xl font-semibold text-tprimary">{title}</h2>
        <div className="divider mt-4 flex-1" />
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
      {/* 01 вЂ” Color */}
      <Section index="01" title="Color tokens">
        <div className="grid w-full grid-cols-4 gap-3">
          {swatches.map((s) => (
            <GlassCard key={s.name} hover className="!p-5">
              <div
                className="h-14 w-full rounded-control border border-hairline"
                style={{ background: s.css }}
              />
              <div className="mt-3 text-sm font-medium text-tprimary">{s.name}</div>
              <div className="font-mono text-[11px] text-ttertiary">{s.note}</div>
            </GlassCard>
          ))}
        </div>
      </Section>

      {/* 02 вЂ” Typography */}
      <Section index="02" title="Typography">
        <GlassCard className="w-full">
          <div className="mb-2 text-3xl font-semibold tracking-tight text-tprimary">
            Display вЂ” 30px / 650
          </div>
          <div className="mb-3 text-lg font-semibold text-tprimary">
            Section title вЂ” 20px / 600
          </div>
          <div className="text-[14.5px] text-tsecondary">
            Body вЂ” 14.5px / 400, line-height 1.55. Inter Variable for all UI copy;
            generous whitespace is part of the design.
          </div>
          <div className="mt-6 font-mono text-sm text-tprimary">
            JetBrains Mono вЂ” 12,482 items В· 00:04:32 В· 3840Г—2160 В· 60fps
          </div>
        </GlassCard>
      </Section>

      {/* 03 вЂ” Buttons */}
      <Section index="03" title="Buttons вЂ” chunky pills">
        <PillButton onClick={() => toast.success("Primary action")}>Primary</PillButton>
        <PillButton variant="ghost">Ghost</PillButton>
        <PillButton variant="danger">Danger</PillButton>
        <PillButton size="lg">Page-level</PillButton>
        <IconButton label="Favorite" onClick={() => toast("Favorited")}>
          <Heart size={18} />
        </IconButton>
        <IconButton label="Search">
          <Search size={18} />
        </IconButton>
        <PillButton disabled>Disabled</PillButton>
      </Section>

      {/* 04 вЂ” Chips */}
      <Section index="04" title="Chips">
        <Chip>Type chip</Chip>
        <Chip mono>00:04:32</Chip>
        <Chip mono>3840Г—2160</Chip>
        <Chip mono accent>
          H.264 В· 60FPS
        </Chip>
      </Section>

      {/* 05 вЂ” Segmented */}
      <Section index="05" title="Segmented control">
        <Segmented
          aria-label="Demo view mode"
          options={viewOptions.map((o) => ({ ...o }))}
          value={view}
          onChange={setView}
        />
      </Section>

      {/* 06 вЂ” Slider & FAB */}
      <Section index="06" title="Slider & FAB">
        <GlassCard className="w-full max-w-xl">
          <div className="mb-4 text-base font-medium text-tprimary">Preview size</div>
          <Slider
            value={40}
            onChange={() => {}}
            valueLabel="170px"
            aria-label="Preview size"
          />
        </GlassCard>
        <FAB label="Collage">
          <Star size={22} className="text-tprimary" />
        </FAB>
      </Section>

      {/* 07 вЂ” Glass over content: blur is only visible over colorful media */}
      <Section index="07" title="Glass over content">
        <div className="relative w-full overflow-hidden rounded-card">
          {/* colorful media stand-in */}
          <div
            className="h-72 w-full"
            style={{
              background:
                "radial-gradient(circle at 20% 30%, #6EC1FF 0%, transparent 45%)," +
                "radial-gradient(circle at 80% 20%, #F5B85C 0%, transparent 40%)," +
                "radial-gradient(circle at 70% 85%, #3ECF8E 0%, transparent 45%)," +
                "radial-gradient(circle at 30% 90%, #FF5C5C 0%, transparent 40%)," +
                "#141518",
            }}
          />
          {/* glass panels floating on top */}
          <div className="absolute inset-x-8 top-8">
            <div className="glass rounded-pill px-5 py-2.5">
              <span className="text-sm font-medium text-tprimary">
                Top bar glass
              </span>
            </div>
          </div>
          <div className="absolute inset-x-8 bottom-8 flex items-center gap-3">
            <div className="glass flex items-center gap-2 rounded-pill px-3 py-2">
              <IconButton label="Favorite">
                <Heart size={18} />
              </IconButton>
              <IconButton label="Add to album">
                <Images size={18} />
              </IconButton>
              <IconButton label="Collage">
                <Star size={18} />
              </IconButton>
            </div>
            <div className="glass flex-1 rounded-control px-4 py-2.5">
              <span className="font-mono text-[12px] text-tsecondary">
                00:04:32 / 00:12:08 В· 3840Г—2160
              </span>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}

function ExtraSections() {
  return (
    <>
      {/* 07 вЂ” Dialog & Menu */}
      <Section index="08" title="Dialog & Menu">
        <Dialog>
          <DialogTrigger asChild>
            <PillButton variant="ghost">Open dialog</PillButton>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add library</DialogTitle>
              <DialogDescription>
                Choose a folder or drive to scan. LUMEN never copies your files вЂ”
                everything stays in place.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center justify-center rounded-control border border-dashed border-hairline-hover py-12">
              <span className="text-sm text-ttertiary">Drop folder here</span>
            </div>
            <div className="mt-6 flex justify-end gap-3">
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
              <Heart size={16} /> Favorite
            </MenuItem>
            <MenuItem>
              <CopyPlus size={16} /> Add to album
            </MenuItem>
            <MenuItem>
              <Play size={16} /> Collage
            </MenuItem>
            <MenuItem>
              <Folder size={16} /> Open containing folder
            </MenuItem>
            <MenuSeparator />
            <MenuItem className="text-danger">
              <Trash2 size={16} /> Move to trash
            </MenuItem>
          </MenuContent>
        </Menu>
      </Section>

      {/* 08 вЂ” Empty / loading / progress */}
      <Section index="09" title="Empty state В· Loading В· Progress">
        <div className="flex w-full flex-col gap-6">
          <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-hairline-hover py-16">
            <span className="text-sm text-ttertiary">No items yet</span>
          </div>
          <div className="flex gap-3">
            <div className="shimmer-bg h-28 flex-1 rounded-card" />
            <div className="shimmer-bg h-28 flex-1 rounded-card" />
            <div className="shimmer-bg h-28 flex-1 rounded-card" />
          </div>
          <div>
            <div className="mb-3 flex justify-between">
              <span className="text-sm text-tsecondary">Scan progress</span>
              <span className="font-mono text-[12px] text-ttertiary">3,412 / 12,482</span>
            </div>
            <div className="h-1 w-full rounded-pill bg-surface-2">
              <div className="h-full w-[27%] rounded-pill bg-accent" />
            </div>
          </div>
        </div>
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
          <div className="flex flex-col gap-3">
            <button className="flex h-11 w-full items-center gap-3 rounded-control px-3 text-left text-sm text-tsecondary transition-all duration-[160ms] hover:bg-surface-2/60 hover:text-tprimary">
              <Settings size={18} />
              Settings
            </button>
            <div className="px-3 font-mono text-[10px] leading-relaxed text-ttertiary">
              SCANNINGвЂ¦ 3,412 / 12,482
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
                    <ArrowDownUp size={18} />
                  </IconButton>
                </MenuTrigger>
                <MenuContent align="end">
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
                <CheckSquare size={18} />
              </IconButton>
            </>
          }
        />

        <ScrollArea className="relative flex-1 px-10 py-12">
          <div className="mx-auto max-w-3xl">
            <h1 className="text-4xl font-bold tracking-tight text-tprimary">
              LUMEN Design System
            </h1>
            <p className="mb-16 mt-3 text-[15px] text-tsecondary">
              Living style sheet вЂ” every token and base component, per
              docs/DESIGN.md v2.
            </p>
            <SectionsDemo view={view} setView={setView} />
            <ExtraSections />
            <div className="h-12" />
          </div>
        </ScrollArea>

        {/* floating glass action bar demo */}
        <div className="pointer-events-none absolute bottom-8 left-1/2 z-40 -translate-x-1/2">
          <div className="glass pointer-events-auto flex items-center gap-2 rounded-pill px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,.06),0_8px_24px_rgba(0,0,0,.35)]">
            <IconButton label="Favorite">
              <Heart size={18} />
            </IconButton>
            <IconButton label="Add to album">
              <Images size={18} />
            </IconButton>
            <IconButton label="Collage">
              <Star size={18} />
            </IconButton>
            <IconButton label="Open containing folder">
              <Folder size={18} />
            </IconButton>
            <IconButton label="Trash" className="text-danger">
              <Trash2 size={18} />
            </IconButton>
          </div>
        </div>

        {/* bottom-left status line вЂ” mono metadata only */}
        <div className="pointer-events-none absolute bottom-7 left-10 font-mono text-[11px] text-ttertiary">
          12,482 items - 348 GB - scanned 2s ago
        </div>
      </div>
    </div>
  );
}


