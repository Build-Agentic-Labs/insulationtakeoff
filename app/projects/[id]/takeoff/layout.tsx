export default function TakeoffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Full-screen overlay — covers entire viewport including sidebar.
  // -ml-64 counteracts the parent <main>'s ml-64 so the fixed overlay
  // truly starts at the left edge of the viewport.
  return (
    <div className="fixed inset-0 z-[100] bg-white">
      {children}
    </div>
  );
}
