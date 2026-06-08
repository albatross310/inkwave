// About — placeholder page (empty for now). Reached from the options menu.

import { Link } from 'react-router'

export function About() {
  return (
    <div className="min-h-screen bg-white p-8 font-serif">
      <Link to="/" className="text-sm text-stone-400 hover:text-[#5c2d8a]">← Back</Link>
    </div>
  )
}
