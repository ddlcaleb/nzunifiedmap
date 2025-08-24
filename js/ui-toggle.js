// ui-toggle.js
// External script to manage side navigation open/closed state and menu toggle position.
(function(){
  const menuToggle = document.getElementById('menuToggle');
  const sideNav = document.getElementById('sideNav');
  if(!menuToggle || !sideNav) return;

  function updateTogglePosition(){
    const rect = sideNav.getBoundingClientRect();
    // if sideNav is off-screen (translated), rect.right still returns its original position; we'll compute using width
    const style = window.getComputedStyle(sideNav);
    const width = sideNav.offsetWidth;
    // place the toggle 8px outside the visible edge of the sideNav (right side)
    // If closed (translated -100%), compute left as 8px so it's visible near left edge
    if(document.body.classList.contains('side-closed')){
      menuToggle.style.left = '8px';
    } else {
      const left = Math.min(window.innerWidth - 46, Math.max(8, rect.left + width + 8));
      menuToggle.style.left = left + 'px';
    }
    // vertically center relative to sideNav
    const top = rect.top + (rect.height / 2) - (menuToggle.offsetHeight / 2);
    menuToggle.style.top = Math.max(8, top) + 'px';
  }

  function setSideOpen(open){
    if(open){ document.body.classList.add('side-open'); document.body.classList.remove('side-closed'); menuToggle.textContent = '<'; }
    else { document.body.classList.add('side-closed'); document.body.classList.remove('side-open'); menuToggle.textContent = '>'; }
    requestAnimationFrame(updateTogglePosition);
  }

  // init (start closed by default)
  setSideOpen(false);
  window.addEventListener('resize', updateTogglePosition);
  menuToggle.addEventListener('click', ()=> setSideOpen(!document.body.classList.contains('side-open')));
  const closeBtn = document.querySelector('#sideNav .close-btn');
  if(closeBtn) closeBtn.addEventListener('click', ()=> setSideOpen(false));

  // small delay to ensure layout settled
  setTimeout(updateTogglePosition, 120);

  // Expose for debug
  window.__uiToggle = { setSideOpen };
})();
