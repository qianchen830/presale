// enhance.js - UI/UX Pro Max 动效增强
// 挂载到 window，在 app.js 之后加载

(function () {
  // ── 数字滚动 ──
  function animateCountUp(el, target, duration = 1200) {
    const start = 0;
    const startTime = performance.now();
    const isFloat = String(target).includes('.');
    const decimals = isFloat ? (String(target).split('.')[1] || '').length : 0;

    function easeOutExpo(t) {
      return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    }

    function update(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutExpo(progress);
      const current = start + (target - start) * eased;
      el.textContent = isFloat
        ? current.toFixed(decimals)
        : Math.round(current).toLocaleString('zh-CN');
      if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  }

  // ── 初始化 KPI 数字滚动 ──
  function initKPICountUp() {
    document.querySelectorAll('[data-countup]').forEach(el => {
      const target = parseFloat(el.dataset.countup);
      if (!isNaN(target)) {
        animateCountUp(el, target, 1400);
      }
    });
  }

  // ── Intersection Observer 入场动画 ──
  function initScrollAnimations() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const el = entry.target;
          const delay = parseFloat(el.dataset.delay || 0);
          setTimeout(() => {
            el.classList.add('visible');
          }, delay * 1000);
          observer.unobserve(el);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('[data-reveal]').forEach(el => {
      observer.observe(el);
    });
  }

  // ── 底部导航动效 ──
  function initNavAnimations() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', function () {
        // Ripple 效果
        const ripple = document.createElement('span');
        ripple.style.cssText = `
          position: absolute;
          border-radius: 50%;
          background: rgba(0, 212, 255, 0.25);
          width: 10px; height: 10px;
          left: 50%; top: 50%;
          transform: translate(-50%, -50%) scale(0);
          animation: navRipple 0.6s ease-out forwards;
          pointer-events: none;
        `;
        this.style.position = 'relative';
        this.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
      });
    });
  }

  // ── 卡片悬浮光效 ──
  function initCardGlow() {
    document.querySelectorAll('.kpi-card, .glass-card').forEach(card => {
      card.addEventListener('mouseenter', function (e) {
        const rect = this.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        this.style.setProperty('--mouse-x', x + 'px');
        this.style.setProperty('--mouse-y', y + 'px');
      });
    });
  }

  // ── 页面切换动画 ──
  function initPageTransitions() {
    const pages = document.querySelectorAll('.page-section');
    pages.forEach(page => {
      page.style.opacity = '0';
      page.style.transform = 'translateY(16px)';
      page.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
    });
  }

  function showPage(name) {
    document.querySelectorAll('.page-section').forEach(p => {
      p.style.opacity = '0';
      p.style.transform = 'translateY(16px)';
      p.style.display = 'none';
    });
    const target = document.querySelector(`.page-section[data-page="${name}"]`);
    if (target) {
      target.style.display = '';
      requestAnimationFrame(() => {
        target.style.opacity = '1';
        target.style.transform = 'translateY(0)';
      });
      // 触发 KPI 动画
      setTimeout(initKPICountUp, 100);
      // 触发滚动动画
      setTimeout(initScrollAnimations, 200);
    }
  }

  // ── 初始化 ──
  function init() {
    // 添加 global keyframes（防止重复）
    if (!document.getElementById('enhance-keyframes')) {
      const style = document.createElement('style');
      style.id = 'enhance-keyframes';
      style.textContent = `
        @keyframes navRipple {
          to { transform: translate(-50%, -50%) scale(20); opacity: 0; }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        [data-reveal] {
          opacity: 0;
          transform: translateY(24px);
          transition: opacity 0.5s ease, transform 0.5s ease;
        }
        [data-reveal].visible {
          opacity: 1;
          transform: translateY(0);
        }
        [data-reveal-delay="1"] { transition-delay: 0.05s; }
        [data-reveal-delay="2"] { transition-delay: 0.10s; }
        [data-reveal-delay="3"] { transition-delay: 0.15s; }
        [data-reveal-delay="4"] { transition-delay: 0.20s; }
        [data-reveal-delay="5"] { transition-delay: 0.25s; }
        [data-reveal-delay="6"] { transition-delay: 0.30s; }
        .kpi-value {
          display: inline-block;
          min-width: 2ch;
        }
        .list-item {
          opacity: 0;
          transform: translateX(-12px);
          transition: opacity 0.4s ease, transform 0.4s ease, background 0.2s ease;
        }
        .list-item.visible {
          opacity: 1;
          transform: translateX(0);
        }
        .fab {
          animation: fabAppear 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        @keyframes fabAppear {
          from { opacity: 0; transform: scale(0.5) rotate(-20deg); }
          to   { opacity: 1; transform: scale(1) rotate(0); }
        }
        .btn:active {
          transform: scale(0.94) !important;
        }
        .modal-overlay {
          animation: overlayFadeIn 0.25s ease forwards;
        }
        @keyframes overlayFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .modal-box {
          animation: modalSlideUp 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
        }
        @keyframes modalSlideUp {
          from { transform: translateY(60px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    // 初始化观察器
    initScrollAnimations();

    // 导航动画
    initNavAnimations();

    // 页面过渡
    window.__showPage = showPage;

    // 初始化页面
    setTimeout(() => {
      initKPICountUp();
    }, 300);
  }

  // DOMReady 后启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 100);
  }
})();
