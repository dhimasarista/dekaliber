import { defineEventHandler, createEventStream, getRouterParam, createError } from 'h3';
import { getSnapshot, subscribe } from '../../../../utils/run-manager';

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, statusMessage: 'run id is required' });

  const initial = getSnapshot(id);
  if (!initial) throw createError({ statusCode: 404, statusMessage: `Run ${id} not found` });

  const eventStream = createEventStream(event);

  const unsubscribe = subscribe(id, (eventName, data) => {
    void eventStream.push({ event: eventName, data: JSON.stringify(data) });
    if (eventName === 'done') void eventStream.close();
  });

  eventStream.onClosed(() => {
    unsubscribe?.();
  });

  // `send()` harus dipanggil dulu supaya header stream ter-flush ke klien;
  // push sebelum send() akan menggantung karena writer belum terpasang.
  const sent = eventStream.send();
  void eventStream.push({ event: 'update', data: JSON.stringify(initial) });

  return sent;
});
