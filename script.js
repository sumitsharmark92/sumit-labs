/* ============================================================
   SUMIT.SH — Main Interactive Engine
   Matrix rain, scroll reveals, tilt cards, particles,
   terminal typing, magnetic buttons, and more.
   ============================================================ */

(function () {
  'use strict';

  // ========== MATRIX RAIN ==========
  const matrixCanvas = document.getElementById('matrix-rain');
  if (matrixCanvas) {
    const ctx = matrixCanvas.getContext('2d');
    let columns, drops;
    const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF<>{}[]|;:./\\';
    const fontSize = 14;

    function initMatrix() {
      matrixCanvas.width = window.innerWidth;
      matrixCanvas.height = window.innerHeight;
      columns = Math.floor(matrixCanvas.width / fontSize);
      drops = Array.from({ length: columns }, () => Math.random() * -100);
    }

    function drawMatrix() {
      ctx.fillStyle = 'rgba(10, 10, 10, 0.06)';
      ctx.fillRect(0, 0, matrixCanvas.width, matrixCanvas.height);
      ctx.fillStyle = '#00ff41';
      ctx.font = `${fontSize}px monospace`;

      for (let i = 0; i < drops.length; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        const x = i * fontSize;
        const y = drops[i] * fontSize;

        // Vary brightness
        const brightness = Math.random();
        if (brightness > 0.95) {
          ctx.fillStyle = '#ffffff';
        } else if (brightness > 0.7) {
          ctx.fillStyle = '#00ff41';
        } else {
          ctx.fillStyle = 'rgba(0, 255, 65, 0.4)';
        }

        ctx.fillText(char, x, y);

        if (y > matrixCanvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
    }

    initMatrix();
    window.addEventListener('resize', initMatrix);

    // ~30fps for performance
    let lastFrame = 0;
    function matrixLoop(timestamp) {
      if (timestamp - lastFrame > 33) {
        drawMatrix();
        lastFrame = timestamp;
      }
      requestAnimationFrame(matrixLoop);
    }
    requestAnimationFrame(matrixLoop);
  }

  // ========== PARTICLE CURSOR TRAIL ==========
  const particleCanvas = document.getElementById('particle-canvas');
  if (particleCanvas) {
    const pCtx = particleCanvas.getContext('2d');
    let particles = [];
    let mouseX = 0, mouseY = 0;

    function initParticles() {
      particleCanvas.width = window.innerWidth;
      particleCanvas.height = window.innerHeight;
    }

    initParticles();
    window.addEventListener('resize', initParticles);

    document.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;

      // Spawn 2 particles per frame
      for (let i = 0; i < 2; i++) {
        particles.push({
          x: mouseX + (Math.random() - 0.5) * 10,
          y: mouseY + (Math.random() - 0.5) * 10,
          vx: (Math.random() - 0.5) * 1.5,
          vy: (Math.random() - 0.5) * 1.5,
          life: 1,
          size: Math.random() * 3 + 1,
        });
      }

      // Cap particle count
      if (particles.length > 80) {
        particles = particles.slice(-80);
      }
    });

    function drawParticles() {
      pCtx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.02;

        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }

        pCtx.beginPath();
        pCtx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        pCtx.fillStyle = `rgba(0, 255, 65, ${p.life * 0.5})`;
        pCtx.fill();
      }

      requestAnimationFrame(drawParticles);
    }
    requestAnimationFrame(drawParticles);
  }

  // ========== SCROLL PROGRESS BAR ==========
  const scrollProgressEl = document.getElementById('scrollProgress');
  if (scrollProgressEl) {
    window.addEventListener('scroll', () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
      scrollProgressEl.style.width = `${progress}%`;
    }, { passive: true });
  }

  // ========== NAVBAR SCROLL STATE ==========
  const navbar = document.getElementById('navbar');
  if (navbar) {
    window.addEventListener('scroll', () => {
      if (window.scrollY > 50) {
        navbar.classList.add('scrolled');
      } else {
        navbar.classList.remove('scrolled');
      }
    }, { passive: true });
  }

  // ========== ACTIVE NAV TRACKING ==========
  const sections = document.querySelectorAll('.section[id]');
  const navLinksAll = document.querySelectorAll('.nav-links a[href^="#"], .mobile-nav a[href^="#"]');

  function updateActiveNav() {
    const scrollPos = window.scrollY + 200;
    sections.forEach((section) => {
      const top = section.offsetTop;
      const height = section.offsetHeight;
      const id = section.getAttribute('id');

      if (scrollPos >= top && scrollPos < top + height) {
        navLinksAll.forEach((link) => {
          link.classList.remove('active');
          if (link.getAttribute('href') === `#${id}`) {
            link.classList.add('active');
          }
        });
      }
    });
  }
  window.addEventListener('scroll', updateActiveNav, { passive: true });

  // ========== MOBILE NAV TOGGLE ==========
  const navToggle = document.getElementById('navToggle');
  const mobileNav = document.getElementById('mobileNav');

  if (navToggle && mobileNav) {
    navToggle.addEventListener('click', () => {
      const isOpen = mobileNav.classList.toggle('open');
      navToggle.textContent = isOpen ? '✕' : '☰';
    });

    // Close on link click
    mobileNav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        mobileNav.classList.remove('open');
        navToggle.textContent = '☰';
      });
    });
  }

  // ========== SMOOTH SCROLL ==========
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
      const href = anchor.getAttribute('href');
      if (href === '#') return;

      e.preventDefault();
      const target = document.querySelector(href);
      if (target) {
        const offset = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-height')) + 32;
        const top = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });

  // ========== SCROLL REVEAL ==========
  const revealElements = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale');

  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -60px 0px' }
    );

    revealElements.forEach((el) => revealObserver.observe(el));
  } else {
    // Fallback: show all
    revealElements.forEach((el) => el.classList.add('visible'));
  }

  // ========== TYPED NAME EFFECT ==========
  const typedNameEl = document.getElementById('typedName');
  if (typedNameEl) {
    const fullName = 'Sumit\nSharma';
    let nameIndex = 0;

    function typeName() {
      if (nameIndex < fullName.length) {
        const char = fullName[nameIndex];
        if (char === '\n') {
          typedNameEl.innerHTML += '<br>';
        } else {
          typedNameEl.textContent += char;
          // Re-add the line break if it exists
          const text = typedNameEl.innerHTML;
          if (text.includes('&lt;br&gt;')) {
            // shouldn't happen with innerHTML approach
          }
        }
        nameIndex++;
        setTimeout(typeName, 80 + Math.random() * 60);
      }
    }

    // Better approach: build up with innerHTML
    typedNameEl.innerHTML = '';
    nameIndex = 0;
    const nameChars = [];

    function typeNameV2() {
      if (nameIndex < fullName.length) {
        const char = fullName[nameIndex];
        nameChars.push(char);
        typedNameEl.innerHTML = nameChars
          .map((c) => (c === '\n' ? '<br>' : c))
          .join('');
        nameIndex++;
        setTimeout(typeNameV2, 80 + Math.random() * 60);
      }
    }

    // Start after a brief delay
    setTimeout(typeNameV2, 800);
  }

  // ========== TERMINAL TYPING EFFECT ==========
  const terminalBody = document.getElementById('terminalBody');
  if (terminalBody) {
    const lines = [
      { type: 'prompt', text: '› ', delay: 0 },
      { type: 'command', text: '$ ssh sumit@portfolio.local', delay: 50 },
      { type: 'newline', delay: 600 },
      { type: 'prompt', text: '› ', delay: 200 },
      { type: 'output', text: 'handshake complete — welcome, visitor.', delay: 30 },
      { type: 'newline', delay: 400 },
      { type: 'prompt', text: '› ', delay: 200 },
      { type: 'command', text: '$ cat /etc/motd', delay: 50 },
      { type: 'newline', delay: 500 },
      { type: 'prompt', text: '› ', delay: 200 },
      { type: 'output', text: 'SOC analyst | pentester | cloud defender', delay: 25 },
      { type: 'newline', delay: 300 },
      { type: 'prompt', text: '› ', delay: 300 },
      { type: 'cursor', delay: 0 },
    ];

    let lineIdx = 0;
    let charIdx = 0;
    let currentSpan = null;

    function typeTerminal() {
      if (lineIdx >= lines.length) return;

      const line = lines[lineIdx];

      if (line.type === 'newline') {
        terminalBody.appendChild(document.createElement('br'));
        lineIdx++;
        setTimeout(typeTerminal, line.delay);
        return;
      }

      if (line.type === 'cursor') {
        const cursorEl = document.createElement('span');
        cursorEl.className = 'cursor-block';
        terminalBody.appendChild(cursorEl);
        return;
      }

      if (charIdx === 0) {
        currentSpan = document.createElement('span');
        currentSpan.className = line.type;
        terminalBody.appendChild(currentSpan);
      }

      if (charIdx < line.text.length) {
        currentSpan.textContent += line.text[charIdx];
        charIdx++;
        setTimeout(typeTerminal, line.delay + Math.random() * 20);
      } else {
        charIdx = 0;
        lineIdx++;
        setTimeout(typeTerminal, 100);
      }
    }

    // Start terminal typing after name typing finishes
    setTimeout(typeTerminal, 2000);
  }

  // ========== 3D TILT CARDS ==========
  const tiltCards = document.querySelectorAll('[data-tilt]');

  tiltCards.forEach((card) => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      const rotateX = ((y - centerY) / centerY) * -8;
      const rotateY = ((x - centerX) / centerX) * 8;

      card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(10px)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) translateZ(0)';
      card.style.transition = 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)';
      setTimeout(() => {
        card.style.transition = '';
      }, 500);
    });

    card.addEventListener('mouseenter', () => {
      card.style.transition = 'none';
    });
  });

  // ========== SKILL TAG SCRAMBLE ==========
  const skillTags = document.querySelectorAll('.skill-tag');
  const scrambleChars = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`0123456789';

  skillTags.forEach((tag) => {
    const originalText = tag.textContent;
    let scrambleInterval;

    tag.addEventListener('mouseenter', () => {
      let iterations = 0;
      clearInterval(scrambleInterval);

      scrambleInterval = setInterval(() => {
        tag.textContent = originalText
          .split('')
          .map((char, index) => {
            if (index < iterations) return originalText[index];
            return scrambleChars[Math.floor(Math.random() * scrambleChars.length)];
          })
          .join('');

        iterations += 1 / 2;

        if (iterations >= originalText.length) {
          clearInterval(scrambleInterval);
          tag.textContent = originalText;
        }
      }, 30);
    });

    tag.addEventListener('mouseleave', () => {
      clearInterval(scrambleInterval);
      tag.textContent = originalText;
    });
  });

  // ========== MAGNETIC BUTTONS ==========
  const buttons = document.querySelectorAll('.btn, .nav-cta');

  buttons.forEach((btn) => {
    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;

      btn.style.transform = `translate(${x * 0.15}px, ${y * 0.15}px)`;
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.transform = '';
      btn.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
      setTimeout(() => {
        btn.style.transition = '';
      }, 300);
    });

    btn.addEventListener('mouseenter', () => {
      btn.style.transition = 'none';
    });
  });

  // ========== TOAST NOTIFICATIONS ==========
  window.showToast = function (message, duration = 3000) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), duration);
  };

  // ========== INIT MESSAGE ==========
  console.log(
    '%c[ sumit.sh ] %cPortfolio loaded successfully.',
    'color: #00ff41; font-weight: bold; font-size: 14px;',
    'color: #a0aab5; font-size: 12px;'
  );
  console.log(
    '%c> Want to see the source? It\'s all vanilla HTML/CSS/JS — no frameworks.',
    'color: #00d4ff; font-size: 11px;'
  );

})();
