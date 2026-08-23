/*
 * Up/down voting, sized to sit inside a table cell.
 *
 * This lived privately inside AllIdeasPage. The idea board now shows the same
 * rows in the same table shape and needs the same control, and two copies of a
 * voting button is how the two screens start disagreeing about what a vote
 * looks like — or worse, about whether you may vote for your own idea.
 *
 * `isSelf` disables both buttons rather than hiding them, so the row keeps its
 * column width and an author can still see the tally their idea has attracted.
 * The server enforces the same rule; this only avoids offering a click that
 * would be refused.
 */
export default function VoteWidget({ ideaId, isSelf, upvotes, downvotes, userVote, onVote }) {
  return (
    <div style={{ display:'inline-flex',alignItems:'center',gap:4 }}>
      <button
        className="btn btn-sm"
        style={{ padding:'2px 6px',fontSize:11,borderRadius:6,
          background:userVote==='up'?'#bbf7d0':'var(--chip-bg)',
          color:userVote==='up'?'#10b981':'var(--text-muted)',
          border:`1px solid ${userVote==='up'?'#bbf7d0':'var(--border)'}` }}
        onClick={() => !isSelf && onVote(ideaId,'up')}
        disabled={isSelf}
      >▲ {upvotes}</button>
      <button
        className="btn btn-sm"
        style={{ padding:'2px 6px',fontSize:11,borderRadius:6,
          background:userVote==='down'?'#fee2e2':'var(--chip-bg)',
          color:userVote==='down'?'#ef4444':'var(--text-muted)',
          border:`1px solid ${userVote==='down'?'#fecaca':'var(--border)'}` }}
        onClick={() => !isSelf && onVote(ideaId,'down')}
        disabled={isSelf}
      >▼ {downvotes}</button>
    </div>
  );
}
