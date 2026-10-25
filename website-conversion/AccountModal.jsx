import { useEffect, useState } from 'react'
import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  deleteUser,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  updateProfile,
} from 'firebase/auth'
import { deleteDoc, doc, setDoc } from 'firebase/firestore'
import { auth, db } from './firebase.js'
import './AccountModal.css'

const EMAIL_RE = /^\S+@\S+\.\S+$/
const MIN_PASSWORD = 8

// Accepts 9876543210, +91 98765 43210, 09876543210 -> stores +919876543210
function normalizePhone(value = '') {
  let digits = String(value).replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return /^[6-9]\d{9}$/.test(digits) ? '+91' + digits : ''
}

function phoneForInput(value = '') {
  return String(value || '').replace(/^\+91/, '')
}

function friendlyError(error) {
  const code = String(error?.code || '').replace(/^firebase:/i, '').trim().toLowerCase()
  switch (code) {
    case 'auth/email-already-in-use':
      return 'This email is already registered. Please log in or reset your password.'
    case 'auth/invalid-email':
      return 'Please enter a valid email address.'
    case 'auth/weak-password':
      return 'Password is too weak. Use at least ' + MIN_PASSWORD + ' characters.'
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-login-credentials':
      return 'Email or password is incorrect. Check your details and try again.'
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact support.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a few minutes before trying again, or reset your password.'
    case 'auth/network-request-failed':
      return 'Network problem. Check your internet connection and try again.'
    case 'auth/timeout':
      return 'The request timed out. Check your connection and try again.'
    case 'auth/requires-recent-login':
      return 'For security, please log in again and then try once more.'
    case 'auth/unauthorized-domain':
      return 'This website domain is not authorized in Firebase Authentication. Add it under Firebase Authentication settings.'
    case 'auth/operation-not-allowed':
      return 'Email/password login is not enabled in Firebase Authentication.'
    case 'auth/invalid-api-key':
    case 'auth/app-not-authorized':
      return 'Firebase configuration is invalid for this website. Please check the project configuration.'
    case 'auth/web-storage-unsupported':
    case 'auth/operation-not-supported-in-this-environment':
      return 'Your browser is blocking the sign-in session. Enable cookies/site storage and try again.'
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return ''
    case 'permission-denied':
    case 'firestore/permission-denied':
      return 'You signed in, but your profile could not be accessed. Check Firestore permissions and try again.'
    case 'unavailable':
    case 'firestore/unavailable':
      return 'The profile service is temporarily unavailable. Please try again shortly.'
    default:
      if (code.startsWith('auth/')) {
        return 'Login failed (' + code.replace('auth/', '') + '). Please try again or contact support with this error code.'
      }
      if (code.includes('permission-denied')) {
        return 'Your profile could not be saved because access was denied. Check Firestore permissions.'
      }
      return 'Something went wrong. Please try again.'
  }
}

function Field({ id, label, ...inputProps }) {
  return (
    <div className="ohk-auth-field">
      <label className="ohk-profile-field-label" htmlFor={id}>{label}</label>
      <input id={id} className="ohk-auth-input" {...inputProps} />
    </div>
  )
}

function PasswordField({ id, label, value, onChange, autoComplete, show, onToggle, placeholder }) {
  return (
    <div className="ohk-auth-field">
      <label className="ohk-profile-field-label" htmlFor={id}>{label}</label>
      <div className="ohk-auth-password">
        <input
          id={id}
          className="ohk-auth-input"
          type={show ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          placeholder={placeholder}
        />
        <button type="button" onClick={onToggle} aria-label={show ? 'Hide password' : 'Show password'}>
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  )
}

export default function AccountModal({
  open,
  onClose,
  authUser,
  authLoading,
  profile,
  profileComplete,
  categoryOptions = [],
  onProfileChange,
  onSignupStateChange,
}) {
  const [mode, setMode] = useState('login') // signed out: login | signup | forgot
  const [view, setView] = useState('account') // signed in: account | password | delete
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', location: '', email: '', password: '' })
  const [categories, setCategories] = useState([])
  const [pw, setPw] = useState({ current: '', next: '' })
  const [confirmText, setConfirmText] = useState('')
  const [deletePassword, setDeletePassword] = useState('')

  const isPasswordUser = Boolean(authUser?.providerData?.some((item) => item.providerId === 'password'))
  const required = Boolean(authUser) && !profileComplete

  // Fill the form from the saved profile
  useEffect(() => {
    if (!authUser) return
    setForm((current) => ({
      ...current,
      name: profile?.name || authUser.displayName || '',
      phone: phoneForInput(profile?.phone),
      location: typeof profile?.location === 'string' ? profile.location : '',
      email: authUser.email || '',
    }))
    setCategories(Array.isArray(profile?.categories) ? profile.categories : [])
  }, [authUser?.uid, profile?.name, profile?.phone, profile?.location, profile?.categories])

  // Reset temporary state when the modal closes
  useEffect(() => {
    if (open) return
    setMode('login')
    setView('account')
    setError('')
    setNotice('')
    setShowPassword(false)
    setAcceptedTerms(false)
    setPw({ current: '', next: '' })
    setConfirmText('')
    setDeletePassword('')
    setForm((current) => ({ ...current, password: '' }))
  }, [open])

  useEffect(() => { setView('account') }, [authUser?.uid])

  if (!open) return null

  const setField = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const clearMessages = () => { setError(''); setNotice('') }
  const switchMode = (next) => { setMode(next); clearMessages(); setShowPassword(false); if (next !== 'signup') setAcceptedTerms(false) }
  const goView = (next) => { setView(next); clearMessages(); setShowPassword(false) }

  const run = async (task) => {
    setBusy(true)
    clearMessages()
    try {
      await task()
    } catch (taskError) {
      console.error('Offerhaikya account action failed:', taskError)
      setError(friendlyError(taskError))
    } finally {
      setBusy(false)
    }
  }

  const handleSignUp = (event) => {
    event.preventDefault()
    const name = form.name.trim()
    const email = form.email.trim()
    const rawPhone = form.phone.trim()
    const phone = rawPhone ? normalizePhone(rawPhone) : ''
    const location = String(form.location || '').trim().slice(0, 100)
    if (name.length < 2) { setError('Please enter your name.'); return }
    if (!location) { setError('Please enter your city or state.'); return }
    if (rawPhone && !phone) { setError('Please enter a valid 10-digit mobile number, or leave it empty.'); return }
    if (!categoryOptions.length) { setError('Categories are still loading. Please try again in a moment.'); return }
    if (!categories.length) { setError('Please select at least one category.'); return }
    if (!EMAIL_RE.test(email)) { setError('Please enter a valid email address.'); return }
    if (form.password.length < MIN_PASSWORD) { setError('Password must be at least ' + MIN_PASSWORD + ' characters.'); return }
    if (!acceptedTerms) { setError('Please accept the Terms & Conditions and Privacy Policy to create your account.'); return }
    run(async () => {
      onSignupStateChange?.(true)
      try {
        const credential = await createUserWithEmailAndPassword(auth, email, form.password)
        const user = credential.user
        await updateProfile(user, { displayName: name })
        const now = new Date().toISOString()
        await setDoc(doc(db, 'userProfiles', user.uid), {
          uid: user.uid,
          email: user.email || email,
          displayName: name,
          name,
          phone,
          categories,
          location,
          profileComplete: true,
          provider: 'password',
          createdAt: now,
          updatedAt: now,
        }, { merge: true })
        onProfileChange?.({ name, phone, categories, location })
        setForm((current) => ({ ...current, password: '' }))
        onClose()
      } finally {
        onSignupStateChange?.(false)
      }
    })
  }

  const handleLogin = (event) => {
    event.preventDefault()
    const email = form.email.trim()
    if (!EMAIL_RE.test(email)) { setError('Please enter a valid email address.'); return }
    if (!form.password) { setError('Please enter your password.'); return }
    run(async () => {
      await signInWithEmailAndPassword(auth, email, form.password)
      setForm((current) => ({ ...current, password: '' }))
    })
  }

  const handleForgot = (event) => {
    event.preventDefault()
    const email = form.email.trim()
    if (!EMAIL_RE.test(email)) { setError('Please enter the email you registered with.'); return }
    run(async () => {
      try {
        await sendPasswordResetEmail(auth, email)
      } catch (resetError) {
        if (resetError?.code !== 'auth/user-not-found') throw resetError
      }
      setNotice('If this email is registered, a password reset link has been sent. Please check your inbox and spam folder.')
    })
  }

  const handleSaveProfile = (event) => {
    event.preventDefault()
    if (!authUser) return
    const name = form.name.trim()
    const rawPhone = form.phone.trim()
    const phone = rawPhone ? normalizePhone(rawPhone) : ''
    const location = String(form.location || '').trim().slice(0, 100)
    if (name.length < 2) { setError('Please enter your name.'); return }
    if (!location) { setError('Please enter your city or state.'); return }
    if (rawPhone && !phone) { setError('Please enter a valid 10-digit mobile number, or leave it empty.'); return }
    if (!categories.length) { setError('Please select at least one category.'); return }
    const wasRequired = required
    run(async () => {
      await setDoc(doc(db, 'userProfiles', authUser.uid), {
        uid: authUser.uid,
        email: authUser.email || '',
        displayName: name,
        name,
        phone,
        categories,
        location,
        profileComplete: true,
        updatedAt: new Date().toISOString(),
      }, { merge: true })
      if (name !== (authUser.displayName || '')) await updateProfile(authUser, { displayName: name })
      onProfileChange?.({ name, phone, categories, location })
      if (wasRequired) onClose()
      else setNotice('Profile saved.')
    })
  }

  const handleChangePassword = (event) => {
    event.preventDefault()
    if (!pw.current) { setError('Please enter your current password.'); return }
    if (pw.next.length < MIN_PASSWORD) { setError('New password must be at least ' + MIN_PASSWORD + ' characters.'); return }
    run(async () => {
      await reauthenticateWithCredential(authUser, EmailAuthProvider.credential(authUser.email, pw.current))
      await updatePassword(authUser, pw.next)
      setPw({ current: '', next: '' })
      setView('account')
      setNotice('Password updated.')
    })
  }

  const handleDeleteAccount = (event) => {
    event.preventDefault()
    if (confirmText.trim().toUpperCase() !== 'DELETE') { setError('Please type DELETE to confirm.'); return }
    if (isPasswordUser && !deletePassword) { setError('Please enter your password to confirm.'); return }
    run(async () => {
      if (isPasswordUser) {
        await reauthenticateWithCredential(authUser, EmailAuthProvider.credential(authUser.email, deletePassword))
      }
      await deleteDoc(doc(db, 'userProfiles', authUser.uid))
      await deleteUser(authUser)
      onProfileChange?.({ name: '', phone: '', categories: [], location: '' })
      onClose()
    })
  }

  const handleSignOut = () => run(async () => {
    await signOut(auth)
    onClose()
  })

  const toggleCategory = (category, checked) => {
    setCategories((current) => checked
      ? [...new Set([...current, category])]
      : current.filter((item) => item !== category))
    setError('')
  }

  let title = 'Log in'
  if (authUser) {
    if (required) title = 'Complete your profile'
    else if (view === 'password') title = 'Change password'
    else if (view === 'delete') title = 'Delete account'
    else title = 'My account'
  } else if (mode === 'signup') title = 'Create your account'
  else if (mode === 'forgot') title = 'Reset your password'

  const messages = (
    <>
      {error ? <p className="ohk-profile-error" role="alert">{error}</p> : null}
      {notice ? <p className="ohk-auth-notice" role="status">{notice}</p> : null}
    </>
  )

  const togglePassword = () => setShowPassword((value) => !value)

  const signedOutView = (
    <>
      {mode === 'login' ? (
        <form className="ohk-auth-form" onSubmit={handleLogin} noValidate>
          <Field id="ohk-auth-email" label="Email" type="email" autoComplete="email" value={form.email} onChange={setField('email')} placeholder="you@example.com" />
          <PasswordField id="ohk-auth-password" label="Password" autoComplete="current-password" value={form.password} onChange={setField('password')} show={showPassword} onToggle={togglePassword} />
          <button type="button" className="ohk-auth-link" onClick={() => switchMode('forgot')}>Forgot password?</button>
          {messages}
          <button type="submit" className="ohk-primary-button" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
        </form>
      ) : null}

      {mode === 'signup' ? (
        <form className="ohk-auth-form" onSubmit={handleSignUp} noValidate>
          <Field id="ohk-auth-name" label="Full name" type="text" autoComplete="name" value={form.name} onChange={setField('name')} placeholder="Your name" />
          <Field id="ohk-auth-phone" label="Mobile number (optional)" type="tel" inputMode="numeric" autoComplete="tel" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value.replace(/\D/g, '').slice(0, 10) }))} maxLength={10} placeholder="10-digit mobile number" />
          <div className="ohk-profile-category-heading">
            <strong>Category <span aria-hidden="true">*</span></strong>
            <small>Select one or more</small>
          </div>
          {categoryOptions.length ? (
            <div className="ohk-profile-category-list">
              {categoryOptions.map((category) => (
                <label className="ohk-profile-category-option" key={category}>
                  <input type="checkbox" checked={categories.includes(category)} onChange={(event) => toggleCategory(category, event.target.checked)} />
                  <span>{category}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="ohk-registration-intro">Categories are loading. Please wait a moment.</p>
          )}
          <Field id="ohk-auth-location" label="Location (city or state) *" type="text" autoComplete="address-level2" value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value.slice(0, 100) }))} maxLength={100} placeholder="Enter City or State" required />
          <Field id="ohk-auth-email" label="Email" type="email" autoComplete="email" value={form.email} onChange={setField('email')} placeholder="you@example.com" />
          <PasswordField id="ohk-auth-password" label="Password" autoComplete="new-password" value={form.password} onChange={setField('password')} show={showPassword} onToggle={togglePassword} placeholder={'At least ' + MIN_PASSWORD + ' characters'} />
          <label className="ohk-auth-terms">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(event) => { setAcceptedTerms(event.target.checked); if (event.target.checked) setError('') }}
              required
              aria-required="true"
            />
            <span>
              I agree to the <a href="/terms-and-condition" target="_blank" rel="noopener noreferrer">Terms &amp; Conditions</a> and <a href="/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
            </span>
          </label>
          {messages}
          <button type="submit" className="ohk-primary-button" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
        </form>
      ) : null}

      {mode !== 'forgot' ? (
        <div className="ohk-auth-tabs ohk-auth-tabs-bottom" role="tablist" aria-label="Log in or sign up">
          <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'is-active' : ''} onClick={() => switchMode('login')}>Log in</button>
          <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'is-active' : ''} onClick={() => switchMode('signup')}>Sign up</button>
        </div>
      ) : null}

      {mode === 'forgot' ? (
        <form className="ohk-auth-form" onSubmit={handleForgot} noValidate>
          <p className="ohk-registration-intro">Enter your email and we will send you a link to set a new password.</p>
          <Field id="ohk-auth-email" label="Email" type="email" autoComplete="email" value={form.email} onChange={setField('email')} placeholder="you@example.com" />
          {messages}
          <button type="submit" className="ohk-primary-button" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
          <button type="button" className="ohk-auth-link" onClick={() => switchMode('login')}>← Back to log in</button>
        </form>
      ) : null}

    </>
  )

  const initial = (form.name || authUser?.email || '?').trim().charAt(0).toUpperCase()

  const profileView = authUser ? (
    <>
      <form className="ohk-auth-form" onSubmit={handleSaveProfile} noValidate>
        <div className="ohk-profile-identity">
          {authUser.photoURL ? <img src={authUser.photoURL} alt="" /> : <span className="ohk-profile-avatar" aria-hidden="true">{initial}</span>}
          <div>
            <strong>{form.name || authUser.displayName || 'Offerhaikya user'}</strong>
            <span>{authUser.email}</span>
          </div>
        </div>

        {required ? (
          <p className="ohk-registration-intro">Choose at least one category to finish registration.</p>
        ) : null}

        <Field id="ohk-acc-name" label="Full name" type="text" autoComplete="name" value={form.name} onChange={setField('name')} />
        <Field id="ohk-acc-phone" label="Mobile number (optional)" type="tel" inputMode="numeric" autoComplete="tel" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value.replace(/\D/g, '').slice(0, 10) }))} maxLength={10} placeholder="10-digit mobile number" />
        <Field id="ohk-acc-email" label="Email" type="email" value={authUser.email || ''} disabled readOnly />

        <div className="ohk-profile-category-heading">
          <strong>Your offer categories <span aria-hidden="true">*</span></strong>
          <small>Select one or more</small>
        </div>
        {categoryOptions.length ? (
          <div className="ohk-profile-category-list">
            {categoryOptions.map((category) => (
              <label className="ohk-profile-category-option" key={category}>
                <input type="checkbox" checked={categories.includes(category)} onChange={(event) => toggleCategory(category, event.target.checked)} />
                <span>{category}</span>
              </label>
            ))}
          </div>
        ) : (
          <p className="ohk-registration-intro">Categories are loading. Please wait a moment.</p>
        )}
                <Field id="ohk-acc-location" label="Location (city or state) *" type="text" autoComplete="address-level2" value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value.slice(0, 100) }))} maxLength={100} placeholder="Enter City or State" required />

        {messages}
        <button type="submit" className="ohk-primary-button" disabled={busy || !categoryOptions.length}>
          {busy ? 'Saving…' : required ? 'Complete registration' : 'Save profile'}
        </button>
      </form>

      <div className="ohk-auth-actions">
        {!required && isPasswordUser ? <button type="button" className="ohk-auth-link" onClick={() => goView('password')}>Change password</button> : null}
        <button type="button" className="ohk-auth-link" onClick={handleSignOut} disabled={busy}>Sign out</button>
        {!required ? <button type="button" className="ohk-auth-link is-danger" onClick={() => goView('delete')}>Delete my account</button> : null}
      </div>
    </>
  ) : null

  const passwordView = (
    <form className="ohk-auth-form" onSubmit={handleChangePassword} noValidate>
      <PasswordField id="ohk-pw-current" label="Current password" autoComplete="current-password" value={pw.current} onChange={(event) => setPw((current) => ({ ...current, current: event.target.value }))} show={showPassword} onToggle={togglePassword} />
      <PasswordField id="ohk-pw-new" label="New password" autoComplete="new-password" value={pw.next} onChange={(event) => setPw((current) => ({ ...current, next: event.target.value }))} show={showPassword} onToggle={togglePassword} placeholder={'At least ' + MIN_PASSWORD + ' characters'} />
      {messages}
      <button type="submit" className="ohk-primary-button" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
      <button type="button" className="ohk-auth-link" onClick={() => goView('account')}>← Back</button>
    </form>
  )

  const deleteView = (
    <form className="ohk-auth-form" onSubmit={handleDeleteAccount} noValidate>
      <p className="ohk-registration-intro">
        This permanently deletes your account and your saved profile (name, phone, email and categories). This cannot be undone.
      </p>
      {isPasswordUser ? (
        <PasswordField id="ohk-del-password" label="Your password" autoComplete="current-password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} show={showPassword} onToggle={togglePassword} />
      ) : (
        <p className="ohk-auth-hint">For security, you may need to sign in again before deleting this account.</p>
      )}
      <Field id="ohk-del-confirm" label="Type DELETE to confirm" type="text" autoComplete="off" value={confirmText} onChange={(event) => setConfirmText(event.target.value)} />
      {messages}
      <button type="submit" className="ohk-danger-button" disabled={busy}>{busy ? 'Deleting…' : 'Delete my account'}</button>
      <button type="button" className="ohk-auth-link" onClick={() => goView('account')}>← Keep my account</button>
    </form>
  )

  let body = signedOutView
  if (authLoading) body = <p className="ohk-registration-intro">Checking your sign-in status…</p>
  else if (authUser) body = required || view === 'account' ? profileView : view === 'password' ? passwordView : deleteView

  return (
    <div className={'ohk-modal-backdrop' + (required ? ' ohk-profile-required-backdrop' : '')}>
      <div className="ohk-modal ohk-profile-modal ohk-auth-modal" role="dialog" aria-modal="true" aria-labelledby="ohk-auth-title" onClick={(event) => event.stopPropagation()}>
        <div className="ohk-modal-head">
          <h2 id="ohk-auth-title">{title}</h2>
          {!required ? <button type="button" className="ohk-auth-close" onClick={onClose} aria-label="Close">×</button> : null}
        </div>
        {body}
      </div>
    </div>
  )
}
