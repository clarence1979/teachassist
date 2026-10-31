import { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { CredentialsProvider, useCredentials } from './contexts/CredentialsContext';
import { DbProvider } from './db/DbContext';
import { AppShell } from './components/AppShell';
import { IframeWaitScreen } from './components/IframeWaitScreen';
import { LoginForm } from './components/LoginForm';
import { ChatView } from './views/ChatView';
import { StudioView } from './views/StudioView';
import { TodoView } from './views/TodoView';
import { TimetableView } from './views/TimetableView';
import { LibraryView } from './views/LibraryView';
import { SettingsView } from './views/SettingsView';
import { LlmTestView } from './views/dev/LlmTestView';
import { InfographicPosterView } from './views/InfographicPosterView';
import { SharedBlockView } from './views/SharedBlockView';
import { useAppStore } from './store/appStore';

function AppRoutes() {
  const { authStage, isIframe } = useCredentials();
  const location = useLocation();
  const theme = useAppStore((s) => s.theme);
  const fontSize = useAppStore((s) => s.fontSize);

  // Mark body so CSS can differentiate iframe vs standalone
  useEffect(() => {
    document.body.classList.toggle('is-iframe', isIframe);
  }, [isIframe]);

  // Apply theme and font-size to <html> so CSS vars cascade everywhere
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-font-size', fontSize);
  }, [fontSize]);

  const isPublic = location.pathname.startsWith('/share/');
  if (isPublic) {
    return (
      <Routes>
        <Route path="/share/:shareId" element={<SharedBlockView />} />
      </Routes>
    );
  }

  if (authStage === 'loading') {
    return <IframeWaitScreen />;
  }

  if (authStage === 'login') {
    return <LoginForm />;
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/chat" replace />} />
        <Route path="/chat" element={<ChatView />} />
        <Route path="/studio" element={<StudioView />} />
        <Route path="/todo" element={<TodoView />} />
        <Route path="/timetable" element={<TimetableView />} />
        <Route path="/library" element={<LibraryView />} />
        <Route path="/settings" element={<SettingsView />} />
        <Route path="/infographic-poster" element={<InfographicPosterView />} />
        <Route path="/dev/llm-test" element={<LlmTestView />} />
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <CredentialsProvider>
      <DbProvider>
        <HashRouter>
          <AppRoutes />
        </HashRouter>
      </DbProvider>
    </CredentialsProvider>
  );
}
