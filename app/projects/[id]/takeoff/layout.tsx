export default function TakeoffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[100] bg-[#0e1511]">
      {children}
    </div>
  );
}
