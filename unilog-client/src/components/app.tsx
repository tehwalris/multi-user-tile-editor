import * as R from "ramda";
import React, { useRef, useState } from "react";
import {
  Action,
  ActionType,
  ClientMessage,
  Coordinates,
  getLayer,
  initialState,
  Layer,
  LogEntry,
  MapWorld,
  MessageType,
  reducer,
  ServerMessage,
  unreachable,
  User,
} from "unilog-shared";
import { makeGetDisplayTiles } from "../get-display-tiles";
import { useImageStore } from "../image-store";
import { generateTileMapFromTileset, TileMap, TileResource } from "../tile-map";
import { useWebSocket } from "../use-web-socket";
import { MapDisplay } from "./map-display";

const styles = {
  map: {
    display: "block",
  } as React.CSSProperties,
};

export function getIndexInLayerFromTileCoord(
  world: MapWorld,
  layerId: number,
  c: Coordinates,
) {
  const layer = getLayer(world, layerId);
  return layer.width! * (c.y - layer.y) + (c.x - layer.x);
}

const serverOrigin = "localhost:8080";
const wsServerURL = `ws://${serverOrigin}`;
const httpServerURL = `//${serverOrigin}`;
const tileSize = 32;

export const AppComponent: React.FC = () => {
  const [remoteLog, setRemoteLog] = useState<LogEntry[]>([]);
  const [localLog, setLocalLog] = useState<LogEntry[]>([]);
  const nextLocalId = useRef<number>(-1);

  const [serverState, setServerState] = useState(initialState);
  const [tileMap, setTileMap] = useState<TileMap>({});

  const [selectedTileSet, setSelectedTileSet] = useState(0);

  const [userId, setUserId] = useState("");

  function addToRemoteLog(entry: LogEntry) {
    setRemoteLog((old) =>
      R.sortBy(
        (e: LogEntry) => e.id,
        R.uniqBy((e) => e.id, [...old, entry]),
      ),
    );
  }

  const wsRef = useWebSocket([wsServerURL], (_msg) => {
    const msg = JSON.parse(_msg.data) as ServerMessage;
    switch (msg.type) {
      case MessageType.InitialServer: {
        setTileMap(generateTileMapFromTileset(msg.initialState.world.tilesets));
        setUserId(msg.userId);
        setServerState(msg.initialState);
        break;
      }
      case MessageType.LogEntryServer: {
        addToRemoteLog(msg.entry);
        break;
      }
      case MessageType.RemapEntryServer: {
        setLocalLog((old) => old.filter((e) => e.id !== msg.oldId));
        addToRemoteLog(msg.entry);
        break;
      }
      case MessageType.RejectEntryServer: {
        const entry = localLog.find((e) => e.id === msg.entryId);
        setLocalLog((old) => old.filter((e) => e.id !== msg.entryId));
        console.warn(
          "action rejected by server",
          entry && entry.action,
          msg.error,
        );
        break;
      }
      default:
        unreachable(msg);
    }
  });

  const runAction = (a: Action) => {
    if (!wsRef.current) {
      return;
    }
    const localEntry = { id: nextLocalId.current, action: a };
    nextLocalId.current--;

    const msg: ClientMessage = {
      type: MessageType.SubmitEntryClient,
      entry: localEntry,
    };
    wsRef.current.send(JSON.stringify(msg));
    setLocalLog((old) => [...old, localEntry]);
  };

  const state = [...remoteLog, ...localLog].reduce((a, c, i) => {
    try {
      return reducer(a, c.action);
    } catch (err) {
      console.warn("ignoring action (rejected by local reducer)", a, i);
      return a;
    }
  }, serverState);

  // TODO get from synced state

  const imageStore = useImageStore(httpServerURL);

  const highestId = Math.max(...Object.keys(tileMap).map((s) => parseInt(s)));

  const mySelectionTileId = 1;
  const othersSelectionTileId = highestId + 2;

  function addCursorLayer(layers: Layer[], users: User[]): Layer[] {
    //we assume that all layers start at one and that the first layer has a width and height
    const referenceLayer = layers[0];

    if (!referenceLayer) {
      return layers;
    }

    const data = new Array(referenceLayer.height! * referenceLayer.width!).fill(
      0,
    );

    for (const user of users) {
      if (user.selection) {
        const tile =
          user.id === userId ? mySelectionTileId : othersSelectionTileId;
        const { x, y, width, height } = user.selection;
        const x1 = Math.min(x, x + width);
        const x2 = Math.max(x, x + width);
        const y1 = Math.min(y, y + height);
        const y2 = Math.max(y, y + height);

        for (let i = x1; i < x2; i++) {
          for (let j = y1; j < y2; j++) {
            data[i + j * referenceLayer.width!] = tile;
          }
        }
      }
    }

    console.log({
      ...referenceLayer,
      id: state.world.nextlayerid,
      data,
      name: "selection-ui",
    });

    return [
      ...layers,
      {
        ...referenceLayer,
        id: state.world.nextlayerid,
        data,
        name: "selection-ui",
      },
    ];
  }

  function addUiTiles(
    tileset: Record<number, TileResource>,
  ): Record<number, TileResource> {
    const mySelectionTile = {
      image: "ui-tiles.png",
      rectangle: { x: 0, y: 0, width: tileSize, height: tileSize },
      flips: { diagonal: false, horizontal: false, vertical: false },
      properties: [],
      idWithoutFlags: mySelectionTileId,
    };
    const othersSelectionTile = {
      image: "ui-tiles.png",
      rectangle: { x: 0, y: 1, width: tileSize, height: tileSize },
      flips: { diagonal: false, horizontal: false, vertical: false },
      properties: [],
      idWithoutFlags: othersSelectionTileId,
    };
    return {
      ...tileset,
      [mySelectionTileId]: mySelectionTile,
      [othersSelectionTileId]: othersSelectionTile,
    };
  }

  const getDisplayTiles = makeGetDisplayTiles(
    addCursorLayer(state.world.layers, state.users),
    addUiTiles(tileMap),
    imageStore,
    tileSize,
  );

  const [isSelecting, setIsSelecting] = useState(false);

  return (
    <div>
      <div style={styles.map}>
        <MapDisplay
          getDisplayTiles={getDisplayTiles}
          width={1000}
          height={1000}
          pixelScale={2}
          offset={{ x: 30, y: 15 }}
          tileSize={tileSize}
          onPointerDown={(c, ev) => {
            setIsSelecting(true);
            runAction({
              type: ActionType.SetSelection,
              userId,
              selection: {
                ...c,
                width: 1,
                height: 1,
              },
            });
          }}
          onPointerUp={(c, ev) => {
            setIsSelecting(false);
            runAction({
              type: ActionType.SetSelection,
              userId,
              selection: undefined,
            });
          }}
          onPointerMove={(c, ev) => {
            if (isSelecting) {
              const oldSelection = state.users.find((u) => u.id === userId)
                ?.selection;

              if (!oldSelection) {
                return;
              }
              const newSelection = {
                x: oldSelection.x,
                y: oldSelection.y,
                width: c.x - oldSelection.x,
                height: c.y - oldSelection.y,
              };
              if (
                oldSelection.width !== newSelection.width ||
                oldSelection.height !== newSelection.height
              ) {
                runAction({
                  type: ActionType.SetSelection,
                  userId,
                  selection: newSelection,
                });
              }
            }
            // TODO implement with cursors
            // const layerId = 11;
            // runAction({
            //   type: ActionType.SetTile,
            //   layerId,
            //   index: getIndexInLayerFromTileCoord(state.world, layerId, c),
            //   tileId: 10,
            // });
          }}
        />
      </div>
      <div className="overlay">
        <div className="selection-list">
          <h3>Tilesets</h3>
          <ul>
            {state.world.tilesets.map((tileset, i) => (
              <li
                key={i}
                onClick={() => setSelectedTileSet(i)}
                className={selectedTileSet === i ? "active" : ""}
              >
                {tileset.name}
              </li>
            ))}
          </ul>
        </div>
        <div className="selection-list">
          <h3>Layers</h3>
          <ul>
            {state.world.layers.map((layer, i) => (
              <li
                key={layer.id}
                onClick={() => {
                  runAction({
                    type: ActionType.SetLayerVisibility,
                    layerId: layer.id,
                    visibility: !layer.visible,
                  });
                }}
                className={layer.visible ? "active" : ""}
              >
                {layer.name}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p style={{ width: 300, wordBreak: "break-all" }}>
            {JSON.stringify(state.users)}
          </p>
        </div>
      </div>

      <div>Remote log length: {remoteLog.length}</div>
      <div>Local log length: {localLog.length}</div>
    </div>
  );
};
