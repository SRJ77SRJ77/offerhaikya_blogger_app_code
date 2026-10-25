/* Account modal (login, signup, profile). Uses brand tokens from brand.css when present,
   with fallbacks so it also works without them. */

.ohk-app .ohk-auth-modal { max-width: 460px; }

.ohk-app .ohk-auth-close {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 26px;
  line-height: 1;
  cursor: pointer;
}

.ohk-app .ohk-auth-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin: 0 0 14px;
  padding: 4px;
  border-radius: 12px;
  background: var(--ohk-brand-soft, #fff1e9);
}
.ohk-app .ohk-auth-tabs button {
  min-height: 40px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--ohk-text, #202124);
  font-weight: 800;
  cursor: pointer;
}
.ohk-app .ohk-auth-tabs button.is-active {
  background: var(--ohk-brand, #ff5b01);
  color: var(--ohk-on-brand, #fff);
}

.ohk-app .ohk-auth-form { display: flex; flex-direction: column; gap: 4px; }
.ohk-app .ohk-auth-field { display: flex; flex-direction: column; }

.ohk-app .ohk-profile-modal .ohk-auth-input {
  display: block;
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid var(--ohk-border, #dedede);
  border-radius: 10px;
  background: var(--ohk-surface, #fff);
  color: var(--ohk-text, #202124);
  font: inherit;
  box-sizing: border-box;
}
.ohk-app .ohk-profile-modal .ohk-auth-input:focus {
  border-color: var(--ohk-brand, #ff5b01);
  box-shadow: 0 0 0 3px var(--ohk-brand-ring, rgba(255, 91, 1, .28));
  outline: 0;
}
.ohk-app .ohk-profile-modal .ohk-auth-input:disabled { opacity: .7; cursor: not-allowed; }

.ohk-app .ohk-auth-password { position: relative; }
.ohk-app .ohk-profile-modal .ohk-auth-password .ohk-auth-input { padding-right: 64px; }
.ohk-app .ohk-auth-password button {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  border: 0;
  background: transparent;
  color: var(--ohk-brand-text, #d94800);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.ohk-app .ohk-auth-link {
  align-self: flex-start;
  padding: 6px 0;
  border: 0;
  background: transparent;
  color: var(--ohk-brand-text, #d94800);
  font-size: 13px;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}
.ohk-app .ohk-auth-link:hover { text-decoration: underline; }
.ohk-app .ohk-auth-link:disabled { opacity: .6; cursor: not-allowed; }
.ohk-app .ohk-auth-link.is-danger { color: var(--ohk-danger, #b42318); }

.ohk-app .ohk-auth-hint {
  margin: 4px 0;
  color: var(--ohk-muted, #77747a);
  font-size: 12px;
  line-height: 1.6;
}
.ohk-app .ohk-auth-hint a { color: var(--ohk-brand-text, #d94800); font-weight: 700; }

.ohk-app .ohk-auth-notice {
  margin: 8px 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--ohk-success-bg, #e8f7ed);
  color: var(--ohk-success, #16803d);
  font-size: 13px;
  line-height: 1.5;
}

.ohk-app .ohk-auth-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 14px 0;
  color: var(--ohk-muted, #77747a);
  font-size: 12px;
}
.ohk-app .ohk-auth-divider::before,
.ohk-app .ohk-auth-divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--ohk-border, #e5e5e5);
}

.ohk-app .ohk-auth-actions {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid var(--ohk-border, #ececec);
}

.ohk-app .ohk-danger-button {
  min-height: 44px;
  padding: 12px 22px;
  border: 0;
  border-radius: 10px;
  background: var(--ohk-danger, #b42318);
  color: #fff;
  font-weight: 900;
  cursor: pointer;
}
.ohk-app .ohk-danger-button:hover:not(:disabled) { filter: brightness(.92); }
.ohk-app .ohk-danger-button:disabled,
.ohk-app .ohk-auth-modal .ohk-primary-button:disabled { opacity: .6; cursor: not-allowed; }

/* Dark mode: keep the danger button readable */
.ohk-dark .ohk-danger-button { background: #d9453a; }
