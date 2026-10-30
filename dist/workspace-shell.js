(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const plan = $('designPanel');
  if (!plan) return;
  let planOpen = false;
  let returnFocus = $('showPlanButton');
  let revealFrame;

  function navigationState(button, active) {
    if (!button) return;
    button.classList.toggle('active', active);
    if (button.getAttribute('role') === 'tab') button.setAttribute('aria-selected', String(active));
    else button.setAttribute('aria-pressed', String(active));
  }

  function focusElement(element) {
    if (!element || !element.isConnected || element.closest('[hidden]')) return;
    element.focus({ preventScroll: true });
  }

  function setPlan(open, options = {}) {
    const wasOpen = planOpen;
    planOpen = !!open;
    plan.hidden = !planOpen;
    document.body.classList.toggle('plan-open', planOpen);
    document.body.classList.toggle('chat-focus', !planOpen);
    navigationState($('workspaceChatButton'), !planOpen);
    navigationState($('workspacePlanButton'), planOpen);
    $('showPlanButton')?.setAttribute('aria-expanded', String(planOpen));
    $('workspacePlanButton')?.setAttribute('aria-expanded', String(planOpen));
    cancelAnimationFrame(revealFrame);

    if (planOpen) {
      if (!wasOpen) returnFocus = options.opener || document.activeElement || $('showPlanButton');
      revealFrame = requestAnimationFrame(() => {
        document.dispatchEvent(new CustomEvent('wishouse:plan-open', { detail: { reason: options.reason || 'navigation' } }));
        if (options.focus !== false) {
          const heading = $('planTitle');
          if (heading) heading.tabIndex = -1;
          focusElement(heading || $('closePlanButton'));
        }
      });
    } else if (wasOpen) {
      document.dispatchEvent(new CustomEvent('wishouse:plan-close'));
      if (options.focus === false) return;
      const target = returnFocus?.closest('[hidden]') ? $('showPlanButton') : returnFocus;
      focusElement(target || $('workspaceChatButton'));
    }
  }

  ['showPlanButton', 'workspacePlanButton'].forEach(id => {
    $(id)?.addEventListener('click', event => setPlan(true, { opener: event.currentTarget }));
  });
  $('closePlanButton')?.addEventListener('click', () => setPlan(false));
  $('workspaceChatButton')?.addEventListener('click', event => {
    setPlan(false, { focus: false });
    focusElement($('wishInput') || event.currentTarget);
  });
  document.addEventListener('wishouse:reveal-plan', event => setPlan(true, {
    reason: 'proposal',
    focus: event.detail?.focus !== false,
    opener: $('showPlanButton')
  }));

  function disclosure(buttonId, panelId) {
    const button = $(buttonId), panel = $(panelId);
    if (!button || !panel) return;
    button.setAttribute('aria-controls', panelId);
    button.setAttribute('aria-expanded', String(!panel.hidden));
    button.addEventListener('click', () => {
      if (panel.hidden && plan.contains(panel) && !planOpen) setPlan(true, { focus: false, opener: button });
      panel.hidden = !panel.hidden;
      button.setAttribute('aria-expanded', String(!panel.hidden));
      button.classList.toggle('active', !panel.hidden);
    });
  }
  disclosure('toggleModulesButton', 'moduleLibrary');
  disclosure('toggleNeedsButton', 'needsPanel');

  const moreButton = $('moreButton'), moreMenu = $('moreMenu');
  function setMenu(open, restoreFocus = false) {
    if (!moreButton || !moreMenu) return;
    moreMenu.hidden = !open;
    moreButton.setAttribute('aria-expanded', String(open));
    if (open) focusElement(moreMenu.querySelector('button:not(:disabled), a[href]'));
    else if (restoreFocus) focusElement(moreButton);
  }
  if (moreButton && moreMenu) {
    moreButton.setAttribute('aria-controls', 'moreMenu');
    moreButton.setAttribute('aria-expanded', 'false');
    moreMenu.hidden = true;
    moreButton.addEventListener('click', () => setMenu(moreMenu.hidden));
    moreMenu.addEventListener('click', event => {
      if (event.target.closest('button, a[href]')) setMenu(false, !document.querySelector('dialog[open]'));
    });
    moreMenu.addEventListener('focusout', () => queueMicrotask(() => {
      if (!moreMenu.contains(document.activeElement) && document.activeElement !== moreButton) setMenu(false);
    }));
    document.addEventListener('pointerdown', event => {
      if (!moreMenu.hidden && !moreMenu.contains(event.target) && !moreButton.contains(event.target)) setMenu(false);
    });
    moreMenu.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const items = [...moreMenu.querySelectorAll('button:not(:disabled), a[href]')];
      if (!items.length) return;
      const current = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
        (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      event.preventDefault();
      focusElement(items[next]);
    });
  }

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return;
    if (moreMenu && !moreMenu.hidden) {
      event.preventDefault();
      setMenu(false, true);
    } else if (planOpen) {
      event.preventDefault();
      setPlan(false);
    }
  });

  document.addEventListener('wishouse:state', event => {
    const data = event.detail || {};
    const count = Math.max(0, Number(data.roomCount) || 0);
    const area = Math.max(0, Number(data.area) || 0);
    const needs = Array.isArray(data.requirements) ? data.requirements.length : Math.max(0, Number(data.requirements) || 0);
    const values = { miniRoomCount: count, miniArea: area.toFixed(1), miniNeedCount: needs, miniBedroomCount: Math.max(0, Number(data.bedrooms) || 0) };
    Object.entries(values).forEach(([id, value]) => { if ($(id)) $(id).textContent = String(value); });
    document.body.classList.toggle('has-conversation', !!data.hasMessages);
    $('showPlanButton')?.setAttribute('aria-label', `查看当前平面，${count} 个空间模块，室内 ${area.toFixed(1)} 平方米`);
  });

  // The workspace view is ephemeral; loading a saved plan always starts with the conversation.
  setPlan(false, { focus: false });
}());
