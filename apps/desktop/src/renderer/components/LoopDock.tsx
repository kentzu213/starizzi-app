import React, { useState } from 'react';
import type { AgentLoop, LoopTask } from '../types/agent-loops';
import { LoopTaskIcon } from './AppIcons';

interface LoopDockProps {
  loops: AgentLoop[];
  activeTask: LoopTask | null;
  onSelectLoop: (loop: AgentLoop) => void;
}

export function LoopDock({ loops, activeTask, onSelectLoop }: LoopDockProps) {
  const [hoveredLoopId, setHoveredLoopId] = useState<string | null>(null);

  return (
    <section className="aw-loops" aria-label="Loop theo nhiệm vụ">
      <div className="aw-loops__title">Loop theo nhiệm vụ</div>
      <div className="aw-loops__list">
        {loops.map((loop) => (
          <div
            key={loop.id}
            className="aw-loop__wrapper"
            onMouseEnter={() => setHoveredLoopId(loop.id)}
            onMouseLeave={() => setHoveredLoopId(null)}
          >
            <button
              type="button"
              className={`aw-loop ${loop.task === activeTask ? 'aw-loop--active' : ''}`}
              onClick={() => onSelectLoop(loop)}
              title={loop.description}
            >
              <span className="aw-loop__icon" aria-hidden="true">
                <LoopTaskIcon task={loop.task} className="aw-loop__icon-svg" />
              </span>
              <span className="aw-loop__text">
                <span className="aw-loop__label">{loop.label}</span>
                <span className="aw-loop__desc">{loop.description}</span>
              </span>
            </button>
            {hoveredLoopId === loop.id && (
              <div className="aw-loop__detail" role="tooltip">
                <p className="aw-loop__detail-desc">{loop.description}</p>
                <span className="aw-loop__detail-agent">
                  Agent: {loop.suggestedAgentId}
                </span>
                <span className="aw-loop__detail-model">
                  Model: {loop.suggestedModel}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
