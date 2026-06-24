// Syntax highlighting
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) window.lucide.createIcons()
  if (window.hljs) document.querySelectorAll('pre code').forEach((el) => window.hljs.highlightElement(el))

  // Copy-to-clipboard buttons on every code block
  document.querySelectorAll('.code').forEach((box) => {
    const btn = document.createElement('button')
    btn.className = 'copy'
    btn.textContent = 'copy'
    btn.addEventListener('click', async () => {
      const code = box.querySelector('code')
      try {
        await navigator.clipboard.writeText(code.innerText)
        btn.textContent = 'copied'
        btn.classList.add('done')
        setTimeout(() => {
          btn.textContent = 'copy'
          btn.classList.remove('done')
        }, 1400)
      } catch {
        btn.textContent = 'failed'
      }
    })
    box.appendChild(btn)
  })

  // Tabbed code groups
  document.querySelectorAll('.tabgroup').forEach((group) => {
    const tabs = group.querySelectorAll('.tab')
    const panes = group.querySelectorAll('.pane')
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('active'))
        panes.forEach((p) => p.classList.remove('active'))
        tab.classList.add('active')
        panes[i].classList.add('active')
      })
    })
  })

  // Active-section highlighting in the sidebar
  const links = [...document.querySelectorAll('.nav a')]
  const map = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]))
  const obs = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          links.forEach((a) => a.classList.remove('active'))
          const a = map.get(e.target.id)
          if (a) a.classList.add('active')
        }
      })
    },
    { rootMargin: '-10% 0px -75% 0px', threshold: 0 }
  )
  document.querySelectorAll('section[id]').forEach((s) => obs.observe(s))
})
