// Dữ liệu trình diễn giữ cùng hợp đồng UI, chưa đại diện camera hoặc AI thật.
export type DemoState = 'online' | 'reconnecting' | 'offline' | 'loading' | 'denied';
export type DemoCamera = { id: string; name: string; location: string; state: DemoState; recording: boolean; bitrate: string; resolution: string };
export const demoCameras: DemoCamera[] = [
  { id: 'living', name: 'Phòng khách', location: 'Tầng 1 · Khu sinh hoạt', state: 'online', recording: true, bitrate: '4.2 Mbps', resolution: '4K' },
  { id: 'front', name: 'Cổng trước', location: 'Ngoài trời · Cổng chính', state: 'online', recording: true, bitrate: '2.4 Mbps', resolution: '1080p' },
  { id: 'backyard', name: 'Sân sau', location: 'Ngoài trời · Vườn sau', state: 'reconnecting', recording: false, bitrate: '—', resolution: '1080p' },
  { id: 'garage', name: 'Gara', location: 'Tầng 1 · Gara', state: 'offline', recording: false, bitrate: '—', resolution: '1080p' },
];
export const demoEvents = [
  { id: 'event-1', title: 'Phát hiện chuyển động', cameraId: 'front', camera: 'Cổng trước', time: '14:28:32', tone: 'amber', detail: 'Chuyển động trong khu vực cổng. Đoạn minh họa dài 30 giây.' },
  { id: 'event-2', title: 'Camera đã kết nối lại', cameraId: 'living', camera: 'Phòng khách', time: '14:10:16', tone: 'green', detail: 'Kết nối được khôi phục sau khi mạng gián đoạn.' },
  { id: 'event-3', title: 'Camera mất kết nối', cameraId: 'garage', camera: 'Gara', time: '14:08:12', tone: 'red', detail: 'Không nhận được dữ liệu từ nguồn camera. Kiểm tra nguồn điện và mạng.' },
  { id: 'event-4', title: 'AI nhận diện người', cameraId: 'living', camera: 'Phòng khách', time: '13:42:05', tone: 'cyan', detail: 'Nhãn AI minh họa: PERSON 98% · xử lý nội bộ 18.4ms.' },
];
export const stateLabels: Record<DemoState, string> = { online: 'Trực tuyến', reconnecting: 'Kết nối lại', offline: 'Mất kết nối', loading: 'Đang tải', denied: 'Không có quyền' };
export type View = 'dashboard' | 'cameras' | 'recordings' | 'events' | 'alerts' | 'settings';
export const navigation: { id: View; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Live Matrix', icon: 'grid' },
  { id: 'cameras', label: 'Camera Zones', icon: 'camera' },
  { id: 'recordings', label: 'Playback & Timeline', icon: 'record' },
  { id: 'events', label: 'AI Detections', icon: 'activity' },
  { id: 'alerts', label: 'Alerts', icon: 'bell' },
  { id: 'settings', label: 'NVR Settings', icon: 'settings' },
];
