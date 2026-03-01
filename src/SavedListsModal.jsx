// src/SavedListsModal.jsx
import { useState } from 'react';
import './SavedListsModal.css';

export default function SavedListsModal({ isOpen, onClose, lists, onDelete, onToggleItem }) {
  // FIX: Αντί να κρατάμε όλη τη λίστα, κρατάμε ΜΟΝΟ το ID της!
  const [activeListId, setActiveListId] = useState(null);

  if (!isOpen) return null;

  // Το Modal διαβάζει ΠΑΝΤΑ τη φρέσκια λίστα κατευθείαν από το App.jsx
  const activeList = lists.find(l => l._id === activeListId);

  const handleClose = () => {
    setActiveListId(null);
    onClose();
  };

  return (
    <div className="lists-overlay" onClick={handleClose}>
      <div className="lists-panel" onClick={e => e.stopPropagation()}>
        <div className="lists-header">
          {activeList ? (
            <button className="back-to-grid-btn" onClick={() => setActiveListId(null)}>← Πίσω</button>
          ) : (
            <h2>Οι Λίστες μου</h2>
          )}
          <button className="close-panel-btn" onClick={handleClose}>✕</button>
        </div>

        <div className="lists-content">
          {!activeList ? (
            /* --- ΠΡΟΒΟΛΗ GRID (ΟΛΕΣ ΟΙ ΛΙΣΤΕΣ) --- */
            lists.length === 0 ? (
              <div className="empty-lists">Δεν έχεις αποθηκεύσει καμία λίστα ακόμα.</div>
            ) : (
              <div className="lists-grid">
                {lists.map(list => {
                  const completed = list.items.filter(i => i.isChecked).length;
                  const total = list.items.length;
                  const progress = total === 0 ? 0 : (completed / total) * 100;

                  return (
                    <div key={list._id} className="list-card" onClick={() => setActiveListId(list._id)}>
                      <button className="delete-list-btn" onClick={(e) => { e.stopPropagation(); onDelete(list._id); }}>✕</button>
                      <h3 className="list-card-title">{list.title}</h3>
                      <span className="list-card-date">{new Date(list.createdAt).toLocaleDateString('el-GR')}</span>
                      
                      <div className="list-progress-wrapper">
                        <div className="list-progress-info">
                          <span>{completed}/{total} Προϊόντα</span>
                          <span>{Math.round(progress)}%</span>
                        </div>
                        <div className="list-progress-bar">
                          <div className="list-progress-fill" style={{ width: `${progress}%` }}></div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            /* --- ΠΡΟΒΟΛΗ CHECKLIST (ΜΕΣΑ ΣΤΗ ΛΙΣΤΑ) --- */
            <div className="checklist-view">
              <h2 className="checklist-title">{activeList.title}</h2>
              
              {/* FIX: Βάλαμε paddingBottom για να μην κρύβονται τα τελευταία είδη κάτω από το footer! */}
              <ul className="checklist-items" style={{ paddingBottom: '90px' }}>
                {activeList.items.map(item => (
                  <li key={item._id || item.id} className={`checklist-item ${item.isChecked ? 'checked' : ''}`} 
                      onClick={() => onToggleItem(activeList._id, item)}>
                    <div className={`custom-checkbox ${item.isChecked ? 'checked' : ''}`}>
                      {item.isChecked && '✓'}
                    </div>
                    <div className="checklist-item-info">
                      <span className="checklist-item-name">{item.text}</span>
                      <span className="checklist-item-store">{item.store} • {item.price.toFixed(2)}€</span>
                    </div>
                  </li>
                ))}
              </ul>

              {/* --- ΝΕΟ: STICKY FOOTER ΓΙΑ ΤΟ ΣΥΝΟΛΙΚΟ ΚΟΣΤΟΣ --- */}
              <div className="checklist-footer">
                <div className="checklist-total-cost">
                  <span className="total-cost-label">Συνολικό Κόστος:</span>
                  <span className="total-cost-amount">
                    {activeList.items.reduce((acc, i) => acc + (i.price || 0), 0).toFixed(2)}€
                  </span>
                </div>
              </div>
              
            </div>
          )}
        </div>
      </div>
    </div>
  );
}