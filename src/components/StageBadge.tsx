export function StageBadge({ stage }: { stage: number }) {
  const labels = ["Unseen", "Flashcard", "Context", "Listening", "Cloze", "Mastery"];
  const colors = [
    "bg-stage-0/15 text-stage-0",
    "bg-stage-1/15 text-stage-1",
    "bg-stage-2/15 text-stage-2",
    "bg-stage-3/15 text-stage-3",
    "bg-stage-4/15 text-stage-4",
    "bg-stage-5/15 text-stage-5",
  ];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider ${colors[stage]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: `var(--stage-${stage})` }} />
      Stage {stage} · {labels[stage]}
    </span>
  );
}
