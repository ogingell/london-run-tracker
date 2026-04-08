export default function Layout({ children }) {
  return (
    <div className="h-screen w-screen overflow-hidden bg-dark-900 text-slate-100">
      {children}
    </div>
  );
}
