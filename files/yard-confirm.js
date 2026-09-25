// Общий диалог подтверждения yardConfirm_(html, cb, eyebrow, okText) - канон ГОСТа «Диалог подтверждения»
// (DESIGN_SYSTEM.md, раздел 4) для рискованных редких действий, доступный на ЛЮБОЙ странице. До 24.09 канон
// жил только внутри Планировки (#page-logistics-plan, её showConfirmDialog_) - нарушение правила 6-бис.
// Отдельный файл - заготовка будущего core/ (дорожная карта, этап 4.3). Стили - yard-confirm.css.
// cb(true) - подтвердили, cb(false) - Отмена / Escape / клик по скриму. html - доверенная разметка
// (вызывающий экранирует данные сам), ключевые слова - <b> (подсвечиваются семантическим --amber).
(function () {
  'use strict';
  var conf = null;
  function ensure() {
    if (conf) return conf;
    var scrim = document.createElement('div');
    scrim.className = 'yconf-scrim';
    var box = document.createElement('div');
    box.className = 'yconf-box';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML = '<div class="yconf-eyebrow"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M10 6v5M10 14h.01"/><circle cx="10" cy="10" r="8"/></svg>' +
      '<span class="yconf-eyebrow-t"></span></div><div class="yconf-text"></div><div class="yconf-actions">' +
      '<button type="button" class="yconf-btn" data-r="0">Отмена</button>' +
      '<button type="button" class="yconf-btn primary" data-r="1">Подтвердить</button></div>';
    document.body.appendChild(scrim);
    document.body.appendChild(box);
    conf = { scrim: scrim, box: box, cb: null };
    function close(ok) {
      scrim.classList.remove('open'); box.classList.remove('open');
      var cb = conf.cb; conf.cb = null;
      if (cb) cb(ok);
    }
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-r]');
      if (b) close(b.getAttribute('data-r') === '1');
    });
    scrim.addEventListener('click', function () { close(false); });
    // capture: Escape закрывает диалог раньше, чем его поймает шторка под ним
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && box.classList.contains('open')) { e.stopPropagation(); close(false); }
    }, true);
    return conf;
  }
  window.yardConfirm_ = function (html, cb, eyebrow, okText) {
    var c = ensure();
    c.box.querySelector('.yconf-text').innerHTML = html;
    c.box.querySelector('.yconf-eyebrow-t').textContent = eyebrow || 'Подтверждение';
    c.box.querySelector('[data-r="1"]').textContent = okText || 'Подтвердить';
    c.cb = cb;
    c.scrim.classList.add('open'); c.box.classList.add('open');
    setTimeout(function () { c.box.querySelector('[data-r="0"]').focus(); }, 30);
  };
})();
