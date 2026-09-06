export type Destination =
  'today' | 'agenda' | 'groceries' | 'budget' | 'assistant' | 'watch' | 'robot';

export function NavButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? 'active' : ''}
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
