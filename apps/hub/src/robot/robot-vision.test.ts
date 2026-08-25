import { PassThrough, Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { SimulatedRobotController } from './robot-controller.js';
import {
  captureJpegFrame,
  decodeYolo26Detections,
  iterateJpegFrames,
  VisionRobotController,
} from './robot-vision.js';

describe('Robot vision', () => {
  it('decodes native YOLO26 boxes back into the unpadded camera image', () => {
    expect(
      decodeYolo26Detections(
        new Float32Array([64, 128, 320, 320, 0.8, 56, 10, 90, 20, 120, 0.2, 0]),
        {
          imageHeight: 480,
          imageWidth: 640,
          padX: 0,
          padY: 80,
          scale: 1,
        },
        0.45,
        20,
      ),
    ).toEqual([
      {
        kind: 'object',
        label: 'Chaise',
        confidence: expect.closeTo(0.8),
        box: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 },
      },
    ]);
  });

  it('extracts consecutive JPEG frames from split MJPEG chunks', async () => {
    const first = Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const second = Buffer.from([0xff, 0xd8, 4, 5, 0xff, 0xd9]);
    const stream = Readable.from([
      Buffer.from('boundary'),
      first.subarray(0, 3),
      Buffer.concat([first.subarray(3), Buffer.from('next'), second]),
    ]);
    const frames: Buffer[] = [];
    for await (const frame of iterateJpegFrames(
      stream,
      new AbortController().signal,
    ))
      frames.push(frame);
    expect(frames).toEqual([first, second]);
  });

  it('returns the first complete image for an explicit refresh', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 1, 0xff, 0xd9]);
    await expect(
      captureJpegFrame(
        Readable.from([Buffer.from('header'), jpeg]),
        new AbortController().signal,
      ),
    ).resolves.toEqual(jpeg);
  });

  it('keeps read-only detections visible without enabling actuators', async () => {
    const base = new SimulatedRobotController();
    const jpeg = Buffer.from([0xff, 0xd8, 1, 0xff, 0xd9]);
    base.openCameraStream = vi.fn().mockResolvedValue({
      body: Readable.from([jpeg]),
      contentType: 'image/jpeg',
    });
    const engine = {
      close: vi.fn().mockResolvedValue(undefined),
      detect: vi.fn().mockResolvedValue([
        {
          kind: 'person' as const,
          label: 'Une identité interdite',
          confidence: 0.82,
          box: { x: 0.1, y: 0.2, width: 0.3, height: 0.6 },
        },
      ]),
    };
    const controller = new VisionRobotController(base, engine, {
      startImmediately: false,
    });

    await controller.refresh();
    const state = await controller.state();
    expect(state).toMatchObject({
      actuators: { wheelsEnabled: false, cameraServosEnabled: false },
      armed: false,
      moving: false,
      vision: {
        detections: [
          {
            kind: 'person',
            label: 'Personne',
            confidence: 0.82,
            trackId: null,
          },
        ],
      },
    });
    expect(engine.detect).toHaveBeenCalledOnce();
    expect(
      controller.visionKeyframe(state.vision?.frameId ?? -1)?.image,
    ).toEqual(expect.any(Buffer));
    await controller.close();
    expect(engine.close).toHaveBeenCalledOnce();
  });

  it('shares the detector camera stream with the UI without opening a second camera', async () => {
    const base = new SimulatedRobotController();
    const source = new PassThrough();
    base.openCameraStream = vi.fn().mockResolvedValue({
      body: source,
      contentType: 'multipart/x-mixed-replace; boundary=FRAME',
    });
    const controller = new VisionRobotController(
      base,
      { detect: vi.fn().mockResolvedValue([]) },
      { frameStride: 2, startImmediately: false },
    );
    const abort = new AbortController();
    const uiStream = await controller.openCameraStream(abort.signal);
    const uiFrame = captureJpegFrame(uiStream.body, abort.signal);
    await vi.waitFor(() =>
      expect(base.openCameraStream).toHaveBeenCalledOnce(),
    );

    const jpeg = Buffer.from([0xff, 0xd8, 7, 8, 9, 0xff, 0xd9]);
    source.write(jpeg);

    await expect(uiFrame).resolves.toEqual(jpeg);
    expect(uiStream.contentType).toBe(
      'multipart/x-mixed-replace; boundary=FRAME',
    );
    expect(base.openCameraStream).toHaveBeenCalledOnce();
    abort.abort();
    await controller.close();
  });
});
