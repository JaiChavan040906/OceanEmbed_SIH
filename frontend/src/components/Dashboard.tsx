import { useEffect } from 'react';
import Navbar from './Navbar';
import MapCanvas from './MapCanvas';
import LeftPanel from './LeftPanel';
import RightPanel from './RightPanel';
import ChatDrawer from './ChatDrawer';
import PixelReportModal from './PixelReportModal';
import TimeseriesModal from './TimeseriesModal';
import { useOceanStore } from '../store/oceanStore';
import { fetchMeta, fetchToday } from '../api/client';

export default function Dashboard() {
  const { setDateTime, setMeta, setBackendOnline } = useOceanStore();

  useEffect(() => {
    (async () => {
      try {
        const [meta, today] = await Promise.all([fetchMeta(), fetchToday()]);
        setMeta(meta);
        setBackendOnline(true);
        if (today.mapped_date) {
          setDateTime(today.mapped_date);
        } else if (meta.date_min) {
          setDateTime(meta.date_min);
        }
      } catch {
        setBackendOnline(false);
        setDateTime('2025-09-08');
      }
    })();
  }, [setDateTime, setMeta, setBackendOnline]);

  return (
    <div className="app-root">
      <MapCanvas />
      <Navbar />
      <LeftPanel />
      <RightPanel />
      <ChatDrawer />
      <PixelReportModal />
      <TimeseriesModal />
    </div>
  );
}
