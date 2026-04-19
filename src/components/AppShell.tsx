import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Library, BarChart3 } from "lucide-react";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { location } = useRouterState();
  const path = location.pathname;
  const inStudy = path.startsWith("/study");

  return (
    <div className="min-h-screen bg-background paper">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3">
          <Link to="/" className="group flex items-baseline gap-2">
            <span className="font-display text-xl font-semibold tracking-tight">Fahm</span>
            <span className="arabic text-sm text-muted-foreground">فهم</span>
          </Link>
          <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Quranic Vocabulary
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-28 pt-6">{children}</main>

      {!inStudy && (
        <nav className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2">
          <div className="flex items-center gap-1 rounded-full border border-border bg-card/95 px-2 py-1.5 shadow-lg backdrop-blur">
            <NavItem to="/" icon={<Home className="h-4 w-4" />} label="Today" active={path === "/"} />
            <NavItem to="/decks" icon={<Library className="h-4 w-4" />} label="Decks" active={path.startsWith("/decks")} />
            <NavItem to="/progress" icon={<BarChart3 className="h-4 w-4" />} label="Progress" active={path.startsWith("/progress")} />
          </div>
        </nav>
      )}
    </div>
  );
}

function NavItem({
  to,
  icon,
  label,
  active,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}
