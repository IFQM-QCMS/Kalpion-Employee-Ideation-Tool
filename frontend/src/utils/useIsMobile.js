import { useEffect, useState } from 'react';

// One breakpoint for "this is a phone", shared by the shell and the stylesheet. Keep it in
// step with the @media (max-width:768px) block in index.css - the JSX decides what to
// RENDER at this width (drawer, tab bar), the CSS decides how it LOOKS.
export const MOBILE_QUERY = '(max-width: 768px)';

export function useIsMobile() {
  const get = () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches;
  const [mobile, setMobile] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = (e) => setMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}
