import { Layer } from "unilog-shared";

interface Props {
  layers: Layer[];
  onToggleVisability: (layerId: number, v: boolean) => void;
}
export function LayerList({ layers, onToggleVisability }: Props) {
  return (
    <div className="selection-list">
      <h3>Layers</h3>
      <ul>
        {layers.map((layer, i) => (
          <li
            key={layer.id}
            onClick={() => {
              onToggleVisability(layer.id, !layer.visible);
            }}
            className={layer.visible ? "active" : ""}
          >
            {layer.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
