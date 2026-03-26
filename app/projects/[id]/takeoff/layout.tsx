export default function TakeoffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // This layout renders the takeoff page full-screen,
  // breaking out of the parent layout's sidebar + margin.
  return (
    <div className="fixed inset-0 z-50 bg-white">
      {children}
    </div>
  );
}
