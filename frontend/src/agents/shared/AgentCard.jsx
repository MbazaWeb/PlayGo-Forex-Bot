export default function AgentCard({ title, status, children }) {
  return (
    <section className="panel agent-card" data-working={status === 'Analyzing' || undefined}>
      <div className="agent-card-heading">
        <h2>{title}</h2>
        <span className="agent-state">{status}</span>
      </div>
      {children}
    </section>
  );
}
