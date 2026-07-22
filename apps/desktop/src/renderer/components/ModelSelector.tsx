import React, { useState, useRef, useEffect } from 'react';
import {
  getModelCreditPolicy,
  MODEL_CREDIT_NOTICE_VI,
} from '../../shared/model-credit-policy';
import { MODEL_PROVIDERS } from '../types/agent-registry';
import type { AIProvider, ModelProviderConfig } from '../types/agent-registry';

interface ModelSelectorProps {
  currentModel: string;
  currentProvider: AIProvider;
  onSelect: (model: string, provider: AIProvider) => void;
  /** Override the model groups shown (e.g. izzi + live-discovered local models). */
  groups?: ModelProviderConfig[];
}

export function ModelSelector({ currentModel, currentProvider, onSelect, groups }: ModelSelectorProps) {
  const providers = groups ?? MODEL_PROVIDERS;
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentProviderData = providers.find((p) => p.id === currentProvider);
  const currentModelName =
    currentProviderData?.models.find((m) => m.id === currentModel)?.name ?? currentModel;
  const currentCreditPolicy =
    currentProvider === 'izzi' ? getModelCreditPolicy(currentModel) : 'standard';

  return (
    <div className="model-selector" ref={dropdownRef}>
      <button
        className="model-selector__trigger"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <span className="model-selector__label">Model:</span>
        <span className="model-selector__value">
          <span className="model-selector__value-name">{currentModelName}</span>
          {currentProviderData?.recommended && (
            <span className="model-selector__recommended">⭐</span>
          )}
          {currentCreditPolicy === 'paid-balance-required' && (
            <span className="model-selector__credit-badge">Số dư nạp</span>
          )}
          {currentCreditPolicy === 'may-route-paid-only' && (
            <span className="model-selector__credit-badge">Có thể tính phí</span>
          )}
        </span>
        <span className="model-selector__chevron">{isOpen ? '▴' : '▾'}</span>
      </button>

      {isOpen && (
        <div className="model-selector__dropdown">
          {currentCreditPolicy !== 'standard' && (
            <div className="model-selector__credit-notice" role="note">
              {MODEL_CREDIT_NOTICE_VI[currentCreditPolicy]}
            </div>
          )}
          {providers.map((provider) => (
            <div key={provider.id} className="model-selector__group">
              <div className="model-selector__group-header">
                <span className="model-selector__group-name">
                  {provider.name}
                  {provider.recommended && (
                    <span className="model-selector__badge model-selector__badge--rec">
                      ⭐ Recommended
                    </span>
                  )}
                  {provider.free && (
                    <span className="model-selector__badge model-selector__badge--free">
                      Free
                    </span>
                  )}
                </span>
                <span className="model-selector__group-desc">{provider.description}</span>
              </div>
              {provider.models.map((model) => (
                <button
                  key={`${provider.id}-${model.id}`}
                  className={`model-selector__option ${
                    currentModel === model.id && currentProvider === provider.id
                      ? 'model-selector__option--active'
                      : ''
                  }`}
                  onClick={() => {
                    onSelect(model.id, provider.id);
                    setIsOpen(false);
                  }}
                  type="button"
                >
                  <span className="model-selector__option-name">
                    <span>{model.name}</span>
                    {provider.id === 'izzi' &&
                      getModelCreditPolicy(model.id) === 'paid-balance-required' && (
                        <span className="model-selector__credit-badge">Cần số dư nạp</span>
                      )}
                    {provider.id === 'izzi' &&
                      getModelCreditPolicy(model.id) === 'may-route-paid-only' && (
                        <span className="model-selector__credit-badge">Có thể chọn model trả phí</span>
                      )}
                  </span>
                  {currentModel === model.id && currentProvider === provider.id && (
                    <span className="model-selector__option-check">✓</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
