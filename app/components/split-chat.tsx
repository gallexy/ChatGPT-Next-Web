import { useEffect, useState } from "react";
import { createMessage, useChatStore, useAppConfig } from "../store";
import { useAllModels } from "../utils/hooks";
import { MaskAvatar } from "./mask";
import { ChatControllerPool } from "../client/controller";
import { ServiceProvider } from "../constant";
import { IconButton } from "./button";
import styles from "./split-chat.module.scss";
import Locale from "../locales";
import SendWhiteIcon from "../icons/send-white.svg";
import { Avatar } from "./emoji";
import { useMobileScreen } from "../utils";
import { ChatMessage } from "../store/chat";
import { getClientApi } from "../client/api";
import { getMessageTextContent } from "../utils";

export function SplitChat() {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const config = useAppConfig();
  const allModels = useAllModels();
  const isMobileScreen = useMobileScreen();

  // 左侧和右侧模型配置
  const [leftModel, setLeftModel] = useState(session.mask.modelConfig.model);
  const [rightModel, setRightModel] = useState(() => {
    // 找到一个不同于leftModel的模型
    const availableModels = allModels.filter((m) => m.available);
    const differentModel = availableModels.find((m) => m.name !== leftModel);
    return differentModel
      ? differentModel.name
      : availableModels[0]?.name || leftModel;
  });

  // 用户输入
  const [userInput, setUserInput] = useState("");

  // 消息状态
  const [leftMessages, setLeftMessages] = useState<ChatMessage[]>([]);
  const [rightMessages, setRightMessages] = useState<ChatMessage[]>([]);

  // 初始化消息历史
  useEffect(() => {
    // 仅显示当前会话中的用户消息
    const userMessages = session.messages.filter((m) => m.role === "user");
    setLeftMessages(userMessages);
    setRightMessages(userMessages);
  }, [session.messages]);

  // 处理模型切换
  const handleModelChange = (side: "left" | "right", model: string) => {
    if (side === "left") {
      setLeftModel(model);
    } else {
      setRightModel(model);
    }
  };

  // 处理用户提交
  const handleSubmit = async () => {
    if (!userInput.trim()) return;

    // 创建用户消息
    const userMessage = createMessage({
      role: "user",
      content: userInput,
    });

    // 临时变量存储当前的消息列表
    const newLeftMessages = [...leftMessages, userMessage];
    const newRightMessages = [...rightMessages, userMessage];

    // 添加到左右两侧的消息列表
    setLeftMessages(newLeftMessages);
    setRightMessages(newRightMessages);

    // 清空输入
    setUserInput("");

    // 创建左侧模型回复
    const leftBotMessage = createMessage({
      role: "assistant",
      content: "",
      model: leftModel,
    });

    // 创建右侧模型回复
    const rightBotMessage = createMessage({
      role: "assistant",
      content: "",
      model: rightModel,
    });

    // 添加到各自消息列表
    setLeftMessages([...newLeftMessages, leftBotMessage]);
    setRightMessages([...newRightMessages, rightBotMessage]);

    // 处理右侧模型的回调
    const onRightUpdate = (text: string) => {
      rightBotMessage.content = text;
      setRightMessages([...newRightMessages, rightBotMessage]);
    };

    const onRightError = (error: Error) => {
      console.error("右侧模型错误:", error);
      rightBotMessage.content = "发生错误: " + error.message;
      setRightMessages([...newRightMessages, rightBotMessage]);
    };

    // 处理左侧模型的回调
    const onLeftUpdate = (text: string) => {
      leftBotMessage.content = text;
      setLeftMessages([...newLeftMessages, leftBotMessage]);
    };

    const onLeftError = (error: Error) => {
      console.error("左侧模型错误:", error);
      leftBotMessage.content = "发生错误: " + error.message;
      setLeftMessages([...newLeftMessages, leftBotMessage]);
    };

    try {
      // 获取左侧模型的API客户端
      const leftApi = getClientApi(
        session.mask.modelConfig.providerName || ServiceProvider.OpenAI,
      );
      const leftController = new AbortController();

      // 将控制器添加到池中，以便能够停止请求
      ChatControllerPool.addController(
        session.id,
        leftBotMessage.id,
        leftController,
      );

      // 左侧API请求
      leftApi.llm.chat({
        messages: [
          ...session.mask.context,
          ...newLeftMessages.map((msg) => ({
            role: msg.role,
            content:
              typeof msg.content === "string"
                ? msg.content
                : getMessageTextContent(msg),
          })),
        ],
        config: {
          ...session.mask.modelConfig,
          model: leftModel,
          stream: true,
        },
        onUpdate: onLeftUpdate,
        onFinish: (message) => {
          onLeftUpdate(message);
          ChatControllerPool.remove(session.id, leftBotMessage.id);
        },
        onError: onLeftError,
        onController: (controller) => {
          // 此回调会被API内部调用，并且会传入一个新的controller
          // 我们需要更新池中的controller
          ChatControllerPool.remove(session.id, leftBotMessage.id);
          ChatControllerPool.addController(
            session.id,
            leftBotMessage.id,
            controller,
          );
        },
      });

      // 获取右侧模型的API客户端
      const rightApi = getClientApi(
        session.mask.modelConfig.providerName || ServiceProvider.OpenAI,
      );
      const rightController = new AbortController();

      // 将控制器添加到池中，以便能够停止请求
      ChatControllerPool.addController(
        session.id,
        rightBotMessage.id,
        rightController,
      );

      // 右侧API请求
      rightApi.llm.chat({
        messages: [
          ...session.mask.context,
          ...newRightMessages.map((msg) => ({
            role: msg.role,
            content:
              typeof msg.content === "string"
                ? msg.content
                : getMessageTextContent(msg),
          })),
        ],
        config: {
          ...session.mask.modelConfig,
          model: rightModel,
          stream: true,
        },
        onUpdate: onRightUpdate,
        onFinish: (message) => {
          onRightUpdate(message);
          ChatControllerPool.remove(session.id, rightBotMessage.id);
        },
        onError: onRightError,
        onController: (controller) => {
          // 此回调会被API内部调用，并且会传入一个新的controller
          // 我们需要更新池中的controller
          ChatControllerPool.remove(session.id, rightBotMessage.id);
          ChatControllerPool.addController(
            session.id,
            rightBotMessage.id,
            controller,
          );
        },
      });
    } catch (error) {
      console.error("发送消息错误:", error);
    }
  };

  // 渲染消息内容
  const renderMessageContent = (content: any) => {
    if (typeof content === "string") {
      return content;
    }

    // 如果是多模态内容，尝试提取文本内容
    return getMessageTextContent({ content } as any);
  };

  return (
    <div className={styles["split-chat-container"]}>
      {/* 左侧聊天区域 */}
      <div className={styles["split-chat-side"]}>
        <div className={styles["split-chat-header"]}>
          <div className={styles["model-selector"]}>
            <MaskAvatar avatar={session.mask.avatar} model={leftModel} />
            <select
              value={leftModel}
              onChange={(e) => handleModelChange("left", e.target.value)}
              className={styles["model-select"]}
            >
              {allModels
                .filter((m) => m.available)
                .map((model) => (
                  <option key={model.name} value={model.name}>
                    {model.name}
                  </option>
                ))}
            </select>
          </div>
        </div>

        <div className={styles["split-chat-messages"]}>
          {leftMessages.map((message, i) => (
            <div
              key={i}
              className={
                message.role === "user"
                  ? styles["chat-message-user"]
                  : styles["chat-message"]
              }
            >
              <div className={styles["chat-message-container"]}>
                <div className={styles["chat-message-header"]}>
                  <div className={styles["chat-message-avatar"]}>
                    {message.role === "user" ? (
                      <Avatar avatar={config.avatar} />
                    ) : (
                      <MaskAvatar
                        avatar={session.mask.avatar}
                        model={leftModel}
                      />
                    )}
                  </div>
                  {!message.role.includes("user") && (
                    <div className={styles["chat-model-name"]}>{leftModel}</div>
                  )}
                </div>
                <div className={styles["chat-message-item"]}>
                  {renderMessageContent(message.content)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 右侧聊天区域 */}
      <div className={styles["split-chat-side"]}>
        <div className={styles["split-chat-header"]}>
          <div className={styles["model-selector"]}>
            <MaskAvatar avatar={session.mask.avatar} model={rightModel} />
            <select
              value={rightModel}
              onChange={(e) => handleModelChange("right", e.target.value)}
              className={styles["model-select"]}
            >
              {allModels
                .filter((m) => m.available)
                .map((model) => (
                  <option key={model.name} value={model.name}>
                    {model.name}
                  </option>
                ))}
            </select>
          </div>
        </div>

        <div className={styles["split-chat-messages"]}>
          {rightMessages.map((message, i) => (
            <div
              key={i}
              className={
                message.role === "user"
                  ? styles["chat-message-user"]
                  : styles["chat-message"]
              }
            >
              <div className={styles["chat-message-container"]}>
                <div className={styles["chat-message-header"]}>
                  <div className={styles["chat-message-avatar"]}>
                    {message.role === "user" ? (
                      <Avatar avatar={config.avatar} />
                    ) : (
                      <MaskAvatar
                        avatar={session.mask.avatar}
                        model={rightModel}
                      />
                    )}
                  </div>
                  {!message.role.includes("user") && (
                    <div className={styles["chat-model-name"]}>
                      {rightModel}
                    </div>
                  )}
                </div>
                <div className={styles["chat-message-item"]}>
                  {renderMessageContent(message.content)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 底部输入区域 */}
      <div className={styles["split-chat-input"]}>
        <textarea
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          placeholder={Locale.Chat.Input(config.submitKey)}
          rows={3}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
        <IconButton
          icon={<SendWhiteIcon />}
          text={Locale.Chat.Send}
          onClick={handleSubmit}
          className={styles["chat-input-send"]}
          type="primary"
        />
      </div>
    </div>
  );
}
