(function () {
  'use strict';
  // Browser-only presentation adapter. The shared residential conversation
  // module, server prompts, request schema and model adapters stay unchanged.
  const original = window.WishConversation;
  const welcome = '你好，我们先从这栋办公楼的使用者开始。\n有哪些团队在这里工作？他们需要专注办公、协作会议、制作实验、共享交流，还是花园平台？也可以先讨论某一层，或整栋楼的共同需求。';
  const starters = [
    { label: '办公楼有哪些用户', text: '我想先梳理整栋办公楼的用户：不同团队、访客和共享设施使用者分别需要什么空间？' },
    { label: '团队的工作方式', text: '我们团队既需要安静的专注工作，也经常开会协作。我想先讨论这些工作需求。' },
    { label: '整栋楼的共享需求', text: '我想讨论整栋楼的共享会议、交流和制作空间，怎样回应不同楼层用户的需求。' }
  ];
  function officeSession(session) {
    const first = session.messages?.[0];
    if (first?.role === 'assistant' && !session.messages.some(message => message.role === 'user')) {
      first.text = welcome;
      first.choices = starters.map(choice => ({ ...choice }));
    }
    return session;
  }
  window.WishConversation = {
    ...original,
    newSession: (...args) => officeSession(original.newSession(...args)),
    createConversation: (...args) => officeSession(original.createConversation(...args))
  };
  const topics = [
    { label: '专注与协作', text: '这层用户需要更多安静办公空间，同时保留小组讨论的地方。我们先讨论专注与协作的关系。' },
    { label: '楼层用户变化', text: '这层将加入新的项目团队。我想讨论不同用户加入后，工作空间的需求会如何变化。' },
    { label: '跨层共享空间', text: '我想讨论多个楼层共同使用的会议、制作和交流空间，减少每层重复配置。' },
    { label: '花园平台', text: '我希望这栋办公楼加入花园平台，供用户休息、交流和接触植物。先讨论哪些楼层和用户需要这些户外空间。' }
  ];
  const topicBar = document.querySelector('.chat-topics');
  topicBar.replaceChildren();
  const heading = document.createElement('span'); heading.textContent = '试着聊聊'; topicBar.append(heading);
  topics.forEach(topic => {
    const button = document.createElement('button');
    button.dataset.chatPrompt = topic.text;
    button.append(document.createTextNode(topic.label + ' '));
    const arrow = document.createElement('span'); arrow.textContent = '↗'; button.append(arrow); topicBar.append(button);
  });
  document.querySelector('label[for="wishInput"]').textContent = '描述办公楼用户与工作需求';
  document.getElementById('wishInput').placeholder = '谁在这里工作？需要怎样的办公空间？';
  document.querySelector('.chat-intro strong').textContent = '办公楼助手';
  document.querySelector('.chat-intro>div>span').textContent = '从使用者和工作方式开始。';
  function updateHint() {
    const hint = document.getElementById('chatLimit');
    const text = '先梳理用户与工作需求。3D 模型暂由右侧需求面板调整。';
    if (hint.textContent !== text) hint.textContent = text;
    document.querySelector('#conversationResetNotice>span').textContent = '已从头开始对话，办公楼模型保持不变。';
    document.querySelector('#chatIsolationNotice>span').textContent = '本次从新的工作需求开始；办公楼模型暂未接入聊天。';
  }
  document.addEventListener('wishouse:state', updateHint);
  // Connection-status updates also refresh this line outside chat renders.
  new MutationObserver(updateHint).observe(document.getElementById('chatLimit'), { childList: true, characterData: true, subtree: true });
  updateHint();
}());
