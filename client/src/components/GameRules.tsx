import { useState } from 'react';

interface RuleSection {
  title: string;
  content: string;
}

const GAME_RULES: Record<string, { title: string; sections: RuleSection[] }> = {
  'six-nimmt': {
    title: '젝스님트 (6 Nimmt!) 규칙',
    sections: [
      {
        title: '게임 개요',
        content: '카드를 열에 배치하며 벌점을 최소화하는 게임입니다. 낮은 벌점이 승리!',
      },
      {
        title: '카드 구성',
        content: '인원수에 따라 카드 수가 달라집니다 (인원 × 10 + 4장). 각 카드에는 소머리(벌점)가 있습니다.\n\n• 55번: 7점\n• 11의 배수 (11, 22, 33...): 5점\n• 10의 배수 (10, 20, 30...): 3점\n• 5의 배수 (5, 15, 25...): 2점\n• 나머지: 1점',
      },
      {
        title: '게임 진행',
        content: '1. 각 플레이어에게 10장씩 나눠주고, 4개 열에 카드 1장씩 배치합니다.\n2. 모든 플레이어가 동시에 카드 1장을 선택합니다.\n3. 낮은 숫자부터 순서대로 열에 배치합니다.',
      },
      {
        title: '카드 배치 규칙',
        content: '• 선택한 카드보다 작으면서 가장 가까운 숫자의 열 끝에 배치됩니다.\n• 어떤 열의 마지막 카드보다도 작으면, 원하는 열 하나를 선택해서 가져가야 합니다.',
      },
      {
        title: '6번째 카드 (핵심!)',
        content: '열에 이미 5장이 있는데 6번째 카드를 놓게 되면, 해당 열의 5장을 모두 가져가야 합니다 (벌점!). 내 카드가 새로운 열의 첫 번째 카드가 됩니다.',
      },
      {
        title: '라운드 & 승리',
        content: '• 10장을 모두 내면 라운드 종료, 벌점을 합산합니다.\n• 누군가의 누적 벌점이 66점 이상이 되면 게임 종료!\n• 가장 적은 벌점을 가진 플레이어가 승리합니다.',
      },
      {
        title: '팁',
        content: '• 열의 5번째 자리에 가까운 카드를 주의하세요.\n• 아주 낮은 숫자나 아주 높은 숫자는 위험할 수 있습니다.\n• 열의 벌점 합계를 확인하며 피해를 최소화하세요.',
      },
    ],
  },
};

export default function GameRules({ gameType }: { gameType: string }) {
  const [open, setOpen] = useState(false);
  const rules = GAME_RULES[gameType];

  if (!rules) return null;

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-secondary btn-small rules-btn">규칙 보기</button>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal rules-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rules-header">
              <h2>{rules.title}</h2>
              <button onClick={() => setOpen(false)} className="btn-secondary btn-small">닫기</button>
            </div>
            <div className="rules-content">
              {rules.sections.map((section, i) => (
                <div key={i} className="rules-section">
                  <h3>{section.title}</h3>
                  <p>{section.content}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export { GAME_RULES };
