import "../board.css";

/** What a signed-in staff member without the role sees on /insights: no data, a plain reason. */
export default function NotAllowed() {
  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">Insights</p>
        <h1 className="h1">Not available for your role</h1>
        <p className="lede">Insights shows every client&apos;s details, so it is open to the owner and managers only. Ask the owner if you need it.</p>
      </header>
    </div>
  );
}
