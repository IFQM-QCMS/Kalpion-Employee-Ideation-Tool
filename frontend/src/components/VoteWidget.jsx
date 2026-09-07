// Up/down voting, sized to sit inside a table cell.
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
