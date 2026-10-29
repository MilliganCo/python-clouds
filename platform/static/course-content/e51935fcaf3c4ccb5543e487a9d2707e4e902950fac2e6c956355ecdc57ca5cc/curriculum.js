/* Учебные направления: чистая модель для каталога, карты и переходов этапов. */
(function (root) {
  "use strict";
  const branches = Object.freeze({
    python: Object.freeze({ title: "Python", description: "Основы языка, стандартная библиотека и устройство программ." }),
    tools: Object.freeze({ title: "Инструменты и библиотеки", description: "Работа в IDE, проверка кода и библиотеки для практических задач." }),
  });
  const branchOf = topic => topic?.track === "tools" ? "tools" : "python";
  const fromHash = hash => hash === "#/topics/tools" ? "tools" : "python";
  const href = branch => branch === "tools" ? "#/topics/tools" : "#/topics";
  const topicsIn = (topics, branch) => topics.filter(topic => branchOf(topic) === branch);
  const tasksIn = (topics, branch) => topicsIn(topics, branch).flatMap(topic => topic.tasks);
  function availableTopics(topics, taskXp) {
    if (!taskXp || !Object.keys(taskXp).length) return topics;
    return topics.filter(topic => topic.tasks.every(task => Object.hasOwn(taskXp,task.id)));
  }
  function nextTopic(topics, topic) {
    const list = topicsIn(topics, branchOf(topic));
    const index = list.findIndex(item => item.id === topic?.id);
    return index < 0 ? null : list[index + 1] || null;
  }
  function nextTask(topics, task) {
    const topic = topics.find(item => item.tasks.some(item => item.id === task?.id));
    if (!topic || task.challenge) return null;
    const list = tasksIn(topics, branchOf(topic));
    return list[list.findIndex(item => item.id === task.id) + 1] || null;
  }
  const api = Object.freeze({ branches, branchOf, fromHash, href, topicsIn, tasksIn, availableTopics, nextTopic, nextTask });
  root.Curriculum = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window === "object" ? window : globalThis);
