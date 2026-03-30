import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export type SkillName = 'update-tests' | 'update-uat' | 'regression' | 'sync-design';

const SKILL_META: Record<SkillName, { label: string; description: string }> = {
  'update-tests': {
    label: 'Update Tests',
    description: 'Generate and update functional and non-functional tests from instruction history',
  },
  'update-uat': {
    label: 'Update UAT Spec',
    description: 'Regenerate UAT.md from instruction-history.toon',
  },
  'regression': {
    label: 'Run Regression Suite',
    description: 'Run Jest, TypeScript check, lint, and manual UAT checklist',
  },
  'sync-design': {
    label: 'Sync Design Standards',
    description: 'Scan codebase and update design-standards.md',
  },
};

export class SkillRunner {
  private terminal: vscode.Terminal | null = null;

  constructor(private readonly workspaceRoot: string) {}

  async runSkill(skill: SkillName): Promise<void> {
    const claudePath = vscode.workspace
      .getConfiguration('claudeWorkflow')
      .get<string>('claudePath', 'claude');

    const skillFile = path.join(this.workspaceRoot, '.claude', 'skills', `${skill}.md`);
    const skillExists = fs.existsSync(skillFile);

    if (!skillExists) {
      const open = await vscode.window.showWarningMessage(
        `Skill file not found: .claude/skills/${skill}.md`,
        'Open Skills Folder'
      );
      if (open) {
        vscode.commands.executeCommand(
          'revealInExplorer',
          vscode.Uri.file(path.join(this.workspaceRoot, '.claude', 'skills'))
        );
      }
      return;
    }

    const meta = SKILL_META[skill];

    const terminal = this.getOrCreateTerminal();
    terminal.show(true);

    // Run claude with the slash command — Claude Code picks up local skills from .claude/skills/
    terminal.sendText(`cd "${this.workspaceRoot}" && ${claudePath} "/${skill}"`, true);

    void vscode.window.showInformationMessage(
      `Claude: ${meta.label} — running in terminal`
    );
  }

  async runRegressionInline(): Promise<void> {
    // For regression we can also just run npm test directly in a new terminal
    const terminal = vscode.window.createTerminal({
      name: 'Regression Suite',
      cwd: this.workspaceRoot,
    });
    terminal.show(true);
    terminal.sendText('npm run test && npm run check && npm run lint', true);
  }

  skillExists(skill: SkillName): boolean {
    return fs.existsSync(
      path.join(this.workspaceRoot, '.claude', 'skills', `${skill}.md`)
    );
  }

  getAvailableSkills(): SkillName[] {
    return (Object.keys(SKILL_META) as SkillName[]).filter(s => this.skillExists(s));
  }

  private getOrCreateTerminal(): vscode.Terminal {
    // Reuse existing terminal if still alive
    if (this.terminal && this.isTerminalAlive(this.terminal)) {
      return this.terminal;
    }
    this.terminal = vscode.window.createTerminal({
      name: 'Claude Code Workflow',
      cwd: this.workspaceRoot,
    });
    return this.terminal;
  }

  private isTerminalAlive(terminal: vscode.Terminal): boolean {
    return vscode.window.terminals.includes(terminal);
  }

  static getMeta(skill: SkillName) {
    return SKILL_META[skill];
  }
}
